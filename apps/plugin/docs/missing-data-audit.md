# RaceCor — Missing & Broken Data Audit

Comprehensive audit of on-screen fields that are failing, falling back, hardcoded, or using the wrong data source. Each entry lists what the dashboard shows today and the iRacing SDK / SimHub property that should be wired instead.

---

## 1. Incident Limits (Penalty & DQ Thresholds)

**The biggest gap.** The dashboard hardcodes `17` for penalty and `25` for DQ across three separate modules.

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| "Penalty in" counter | `incidents.js:49` | Hardcoded `penLimit = 17` | iRacing session YAML: `WeekendOptions.IncidentLimit` (penalty threshold) — already readable via `IRatingEstimator.TryReadSessionInfo()` which parses the YAML |
| "DQ in" counter | `incidents.js:50` | Hardcoded `dqLimit = 25` | iRacing session YAML: `WeekendOptions.IncidentLimit` for DQ — iRacing's YAML has both warn and limit values under `ResultsPositions` |
| Drive HUD incident thresholds | `drive-hud.js:126` | Hardcoded `penLimit = 17, dqLimit = 25` | Same — should come from the plugin, not JS constants |
| Commentary viz thresholds | `commentary-viz.js:707` | Hardcoded `penLimit = _settings.incPenalty \|\| 17` | Same — settings fallback masks the real problem |
| Config defaults | `config.js:513` | `incPenalty: 17, incDQ: 25` | Should be populated from telemetry at runtime |

**Fix path:** `IRatingEstimator` already reads session YAML and parses `WeekendOptions`. Add parsing for `IncidentLimit` and `IncidentWarnCount` → expose as properties → wire into `TelemetrySnapshot` → serve via HTTP API → consume in JS.

**Note:** iRacing's YAML structure is `WeekendOptions: IncidentLimit: <value>`. This value varies by series — some series use 17/25, others 8/17, and hosted sessions are fully configurable. The current hardcoded values are wrong for any non-default series.

---

## 2. ACC Incident Count (Wrong Data Source)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Incident counter | `TelemetrySnapshot.Capture.cs:568-569` | Uses `Graphics.Penalties` as a proxy — comment says "ACC doesn't expose incident count directly" | ACC's `Graphics.Penalties` counts penalty *events*, not incident *points*. This is the best available, but the dashboard label says "INC" implying iRacing-style x-counts. Should be relabeled "PEN" for ACC, or use `Physics.NumberOfTyresOut` + `Graphics.SurfacePer` for a closer analog |

---

## 3. Non-iRacing Game Support (Silent Failures)

These fields show `0`, `—`, or empty for every game except iRacing because the capture logic has no handler.

| On-screen field | What it shows | Correct source for ACC/R3E |
|---|---|---|
| Incident count | `0` for RaceRoom, Forza, EAWRC | R3E: `DataCorePlugin.GameRawData.CutTrackWarnings` / ACC: already handled |
| Steering torque | `0.0 Nm` | ACC: `Physics.WheelsTorque` |
| Frame rate | `—` | Not game telemetry — use SimHub's `DataCorePlugin.GameData.FramesPerSecond` (available all games) |
| DRS status | hidden but 0 | ACC: `Graphics.DrsEnabled` + `Graphics.DrsAvailable` |
| Pit stop selections (fuel, pressures, compound) | All `—` | ACC: `Graphics.MfdFuelToAdd`, `Graphics.MfdTyrePressure*` |
| Player car arrays (LapDistPct, OnPitRoad, LapCompleted) | Empty arrays | ACC: not available per-car |
| Pit speed limit | `0` | ACC: `StaticInfo.PitSpeedLimit` / R3E: `DataCorePlugin.GameRawData.SessionPitSpeedLimit` |

---

## 4. iRating & Safety Rating (Fragile Fallback Chain)

The 5-step priority chain works but each step can independently return 0, causing `—` on the dashboard.

| On-screen field | Current chain | Failure mode | Better approach |
|---|---|---|---|
| iRating value | (1) shared memory → (2) IRacingExtraProperties → (3) GameData.IRating → (4) raw PlayerCarDriverIRating → (5) Opponents | Steps 2-5 all fail if the Opponents list hasn't loaded yet; step 1 fails if iRacing restarts mid-session | Add a `_lastKnownIRating` cache that persists the last non-zero value across the session. iRating doesn't change until the session ends, so caching is safe |
| Safety rating value | (1) shared memory → (2) IRacingExtraProperties → (3) GameData.SafetyRating → (4) Opponents | Same fragility | Same fix — cache last known non-zero SR |
| Estimated iR delta | Computed from opponent iRatings and current position | Shows `—` when `EstimatedDelta == 0` — but 0 is a *valid* delta (perfectly average finish) | Distinguish "no data yet" (null/NaN) from "delta is actually zero" |
| License class letter | Derived client-side in `poll-engine.js:456-466` from SR value | Shows `—` when SR is 0 | Available directly in iRacing YAML as `LicString` (e.g. "A 3.41") — `IRatingEstimator` already parses this but doesn't expose the letter separately |

---

## 5. Gap Times (Intermittent Zeros)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Gap ahead (seconds) | `poll-engine.js:597` | Shows `—` when `gap <= 0.05` | Primary source is `IRacingExtraProperties.iRacing_Opponent_Ahead_Gap` which goes to 0 during cautions and pace laps. Should distinguish "no gap data" from "gap is legitimately tiny" — use track position delta as a fallback calculation: `(playerDistPct - aheadDistPct) × estimatedLapTime` |
| Gap behind (seconds) | `poll-engine.js:597` | Same issue | Same fix |
| Gap driver name (ahead) | `poll-engine.js:598` | Shows `—` when string is empty | Opponents list takes 2-3 seconds to populate after session join. Cache last known name |
| Gap driver iRating | `poll-engine.js:599` | Shows empty when `<= 0` | Same caching approach as main iRating |

---

## 6. Sector Data (Missing Boundaries)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Sector 1/2/3 split times | `poll-engine.js:534,540,564` | Shows `—` until the player completes a sector | This is correct behavior — no fix needed, just cosmetic |
| Sector boundaries (S2/S3 start %) | `poll-engine.js:500-502` | Only set if `s2Pct > 0 && s3Pct > s2Pct` — silent failure if YAML parsing fails | `IRatingEstimator.ParseSplitTimeInfo()` already reads these. Add validation logging so a parse failure is detectable |
| Sector delta coloring | `poll-engine.js` | Uses `SectorStateS1/S2/S3` (0=none, 1=pb, 2=faster, 3=slower) | Working correctly for iRacing; not available for ACC — could compute from split time comparison |

---

## 7. Fuel Estimation (Edge Cases)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Fuel remaining | `poll-engine.js:183-194` | Shows `—` when `FuelLevel <= 0` | Correct for pre-session, but also triggers during electric cars and when SimHub hasn't loaded — should check `GameRunning` first |
| Fuel per lap | `poll-engine.js:192` | Shows `—` when value is 0 | SimHub's `DataCorePlugin.Computed.Fuel_LitersPerLap` takes 1-2 laps to stabilize. Currently correct, but could show "calculating..." instead of `—` during lap 1 |
| Estimated laps remaining | `poll-engine.js:189` | `fuel / fuelPerLap` with fallback to 0 | Division by zero protected, but shows `0` rather than `—` when fuelPerLap is 0 |
| Pit fuel suggestion | `TelemetrySnapshot.cs:301-311` | Returns empty string when conditions not met | Should show `—` or "N/A" rather than hiding silently |

---

## 8. Pedal Input Normalization (Unreliable Range)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Throttle % | `poll-engine.js:128-131` | Server value → fallback to client-side `while (thr > 1.01) thr /= 100` loop | The while loop is a hack for games that report 0-100 vs 0-1. Use `DataCorePlugin.GameData.NewData.Throttle` which SimHub already normalizes to 0-1 for all games |
| Brake % | `poll-engine.js:133-136` | Same normalization hack | Same — `DataCorePlugin.GameData.NewData.Brake` |
| Clutch % | `poll-engine.js:138-141` | Same normalization hack | Same — `DataCorePlugin.GameData.NewData.Clutch` |

---

## 9. Flag State (Incomplete ACC Mapping)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Session flags (ACC) | `TelemetrySnapshot.Capture.cs:543-550` | Maps ACC flag types 0-5 to iRacing bitmask — **skips type 6 (penalty)** | Add: `if (accFlag == 6) irMask \|= 0x10000;` to map ACC penalty flag to iRacing black flag bit |
| Session flags (RaceRoom) | `TelemetrySnapshot.Capture.cs:551-556` | Only maps Yellow, Blue, Black | R3E also has: `Flags.Green`, `Flags.White`, `Flags.Checkered` — add those mappings |
| Flag context text | `poll-engine.js:612` | Hardcoded context strings per flag type | Working correctly — no change needed |

---

## 10. Pit Box Panel (iRacing-Only, Silent for Other Games)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Fuel to add | `pitbox.js:117` | Shows `—` when plugin returns falsy | ACC: `Graphics.MfdFuelToAdd` — wirable |
| Tire pressures (LF/RF/LR/RR) | `pitbox.js:125-128` | Shows `—` for non-iRacing | ACC: `Graphics.MfdTyrePressureLF/RF/LR/RR` — directly available |
| Car adjustment rows (TC/ABS/ARB/etc.) | `pitbox.js:136-145` | Hidden unless `Has*` flags are true | Flags are only set when iRacing dc* variables seen non-zero. ACC cars with TC/ABS never trigger because they use different property paths |
| Tire compound | TelemetrySnapshot | `PitSvTireCompound = 0` for non-iRacing | ACC: `Graphics.MfdTyreSet` — maps to wet/dry/etc. |
| Fast repair | TelemetrySnapshot | `PitSvFastRepair = 0` for non-iRacing | iRacing-only concept — hide the row for other games instead of showing 0 |

---

## 11. Session Time / Laps Remaining

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Session time remaining | `poll-engine.js:379-391` | Server-computed `RemainingTimeFormatted` → fallback to client-side calculation | The fallback uses `SessionTimeRemain` which is iRacing raw. For ACC: use `Graphics.SessionTimeLeft`. |
| Laps remaining | Not directly shown | `SessionLapsRemainEx` is in the catalog but not wired | Wire `SessionLapsRemainEx` (avoids the off-by-one in `SessionLapsRemain`) and display in the session info area |

---

## 12. Physics Data (Partial Cross-Game)

| On-screen field | File | What it does today | Correct source |
|---|---|---|---|
| Lateral G | `TelemetrySnapshot.Capture.cs:85` | iRacing raw → SimHub `AccelerationSway` fallback | Working, but units differ: iRacing reports m/s², SimHub normalizes to G. The dashboard assumes G — verify the conversion is applied |
| Longitudinal G | Same | iRacing raw → `AccelerationSurge` | Same unit concern |
| Yaw rate | `poll-engine.js:447` | Shows `0.00 r/s` when no data | iRacing: `YawRate` (rad/s) — correct. Other games: SimHub's `YawVelocity` — verify units match |
| Track temperature | `poll-engine.js:468` | Shows `—°C` when no data | iRacing: `TrackTemp` wired. ACC: `Physics.RoadTemp`. SimHub: `DataCorePlugin.GameData.RoadTemperature` (universal fallback) |

---

## Summary: Priority Fixes

### High Impact (affects every iRacing session)
1. **Incident limits from session YAML** — replace all hardcoded 17/25 values
2. **iRating/SR caching** — prevent intermittent `—` flashes
3. **Estimated iR delta** — distinguish zero from no-data

### Medium Impact (affects specific games/scenarios)
4. **ACC flag type 6 (penalty)** — one line fix in capture logic
5. **ACC pit menu selections** — wire `Graphics.Mfd*` properties
6. **Frame rate** — use SimHub's cross-game `FramesPerSecond` instead of iRacing-only
7. **Gap time fallback** — calculate from track position when IRacingExtraProperties returns 0

### Low Impact (polish)
8. **Pedal normalization** — use SimHub's pre-normalized values
9. **RaceRoom flag expansion** — add green/white/checkered mappings
10. **Fuel edge cases** — better messaging during lap 1
