# AI Race Strategist — Design Document

## The Opportunity

The RaceCor platform already has the bones of a race engineer: 80+ telemetry fields captured at ~30 fps, a trigger/event system, sector tracking, opponent data, and a commentary engine that can surface information to the driver. What it doesn't have is a *strategic brain* — something that watches the whole race unfold, builds a model of what's happening, and tells you what to do about it.

CrewChief monitors and reports. Coach Dave analyzes after the fact. Neither synthesizes everything happening *right now* into actionable, real-time strategy calls the way a human race engineer on a pit wall would. That's the gap.

This document lays out what we can build with the data we already have, what derived data we'd need to compute, and how to turn it into something that's not just helpful but genuinely innovative.

---

## What We Have Today

### Telemetry (TelemetrySnapshot)

Every frame we capture position, speed, RPM, gear, throttle/brake/clutch (raw + normalized), fuel level, fuel per lap, remaining laps, lap times (current/last/best), delta to best, tire wear (FL/FR/RL/RR, 0-1), tire temps, track temp, wet/dry, G-forces (lat/long/vert), yaw rate, steering angle and torque, ABS/TC active states, driver aid settings (brake bias, TC, ABS, ARB, wing, fuel mix, weight jacker), DRS status, ERS battery, incident count, session flags, and pit stop service requests.

### Sector Data (SectorTracker)

Three-sector splits with delta to personal best, sector state classification (PB/faster/slower), and native iRacing sector boundaries when available.

### Opponent Data (Leaderboard)

Position, name, iRating, best lap, last lap, gap to player, and pit status for the entire field. Currently displayed as a windowed view (3 ahead, player, 3 behind) but the full array is built server-side.

### Track Geometry (TrackMapProvider)

Dead-reckoned track outline from velocity + yaw, per-car position interpolation, SVG path, and bundled track maps with turn names and sector data in CSV format.

### Multi-Car Arrays (iRacing)

`CarIdxLapDistPct[]`, `CarIdxOnPitRoad[]`, `CarIdxLapCompleted[]` — per-car-index arrays giving us real-time position and pit status for every car on track.

### Commentary/Trigger System

60+ event topics, severity-based interruption, cooldown management, fragment assembly (opener + body + closer), sentiment colors, and an HTTP API that surfaces everything to the dashboard overlay.

---

## The Strategic Modules

The strategist is not one monolithic system — it's a set of focused analyzers that each maintain their own rolling state, and a strategy coordinator that synthesizes their outputs into prioritized driver calls. Each module below describes what it computes, what data it needs (and whether we have it or need to derive it), and what it tells the driver.


### 1. Tire Lifecycle Tracker

**The Problem:** iRacing's tire model (recently updated for GT3 in Season 3 2025) allows harder initial push but accelerates degradation later. Drivers need to know when their tires transition from "fast" to "falling off" — and the transition is gradual, not a cliff.

**What We Already Have:**
- `TyreWearFL/FR/RL/RR` (0-1 fraction) — direct wear reading per tire
- `TyreTempFL/FR/RL/RR` (degrees C) — temperature per tire
- `TrackTemp` — ambient track surface temperature
- `WeatherWet` — rain flag
- `LapBestTime`, `LapLastTime`, `LapDeltaToBest` — pace degradation signal
- `LatAccel`, `LongAccel` — grip proxy (peak cornering G decreases as tires wear)
- `AbsActive`, `TcActive` — electronic aid activations increase as grip drops
- `SteeringWheelAngle` + `YawRate` — understeer/oversteer detection

**What We'd Derive:**

**Wear rate per stint** — Track `TyreWear` delta per lap, store as a rolling array. Compute linear and quadratic fits to predict when each tire crosses a threshold (say 50%, 70%, 90% worn). The quadratic fit is important because wear accelerates.

**Grip degradation score** — A composite metric combining:
- Peak lateral G per lap (averaged over best 3 corners) — drops as tires wear
- ABS/TC activation frequency per lap — increases as grip drops
- Understeer index: `SteeringWheelAngle / YawRate` ratio at corner apex — rises with understeer from worn fronts
- Lap time trend (exponential moving average of last 5 laps minus fuel-weight correction)

The fuel-weight correction matters: a car gets ~0.05-0.1s faster per lap as fuel burns off. Without it, tire degradation is masked in the first half of a stint and exaggerated in the second half. We can estimate it from `FuelPerLap` and a weight-sensitivity constant per car class (something we'd need to calibrate or approximate from lap time data).

**Tire temperature window** — Track temps over a stint. Optimal grip occurs in a temp band (varies by car/compound but typically 80-100C for GT3). We'd flag "tires overcooking" (sustained >110C) or "tires too cold" (after pit stop, <75C on outlap).

**What It Tells the Driver:**
- "Tires are in the window" (green) / "Fronts getting hot" (yellow) / "Rears falling off — pace dropping 0.4s/lap" (orange)
- "Tyre life estimate: ~8 more laps at current pace before you lose a second"
- On pit outlap: "Bring the tires in gently — fronts need 2 more corners to reach temperature"


### 2. Fuel Strategy Computer

**The Problem:** Most fuel tools tell you "you have X laps of fuel." That's necessary but not sufficient. A strategist needs to answer: "Should I pit now, or can I stretch this stint to undercut/overcut the car ahead?"

**What We Already Have:**
- `FuelLevel` (liters), `FuelPerLap`, `FuelLapsRemaining`
- `RemainingLaps` (race laps remaining, or estimated from session time)
- `SessionTimeRemain`, `IsTimedRace`
- `PitSvFuel` (fuel already requested in iRacing pit menu)
- `PitSvFlags` (what services are queued)
- `IsInPit`, `IsInPitLane`

**What We'd Derive:**

**Fuel burn rate variance** — Track fuel consumption per lap as a rolling array. Compute mean and standard deviation. Flag laps with abnormally high consumption (safety car laps, off-track excursions) and exclude them from projections.

**Minimum fuel to finish** — `ceil(RemainingLaps) * mean(FuelPerLap) + safetyMargin`. The safety margin should be dynamic: 1 lap of fuel in a sprint, 2 laps in an endurance race, more if fuel variance is high.

**Pit window calculation** — When `FuelLapsRemaining` < `RemainingLaps`, compute the last lap you can pit without running dry. Factor in pit lane time loss (we can estimate this from `PitSpeedLimitKmh` and track pit lane length, or calibrate from observed pit stops if we detect them via `IsInPitLane` transitions).

**Fuel-saving mode benefit** — If the driver lifts and coasts, `FuelPerLap` will drop in subsequent laps. We can detect this from the consumption trend and project: "Fuel saving is working — you've gained 2 extra laps of range."

**What It Tells the Driver:**
- "Fuel for 12 more laps, need 15 to finish — pit in 2 laps or start saving"
- "You're burning heavy this stint — 0.3L above average, probably the cold track"
- "If you save 0.1L/lap for the next 5 laps, you can skip the final pit stop"
- "Pit window opens lap 18, closes lap 22 — the car ahead pitted lap 16, undercut is live"


### 3. Pit Strategy Optimizer

**The Problem:** When to pit is the highest-leverage strategic decision in a race. It depends on tire life, fuel, track position, what your competitors are doing, and caution flags. No tool currently synthesizes all of these in real time for sim racers.

**What We Already Have:**
- Everything from modules 1 and 2 above
- Full leaderboard with gaps and pit status
- `SessionFlags` for yellow/caution detection
- `CarIdxOnPitRoad[]` — we know exactly when any car pits

**What We'd Derive:**

**Competitor pit stop tracker** — Monitor `CarIdxOnPitRoad[]` transitions. When a car enters the pit, record their lap number, position, and gap to us. When they exit, record the time loss. Over the race, build a model: which cars have pitted, how many times, and what their strategy appears to be (1-stop, 2-stop, etc.).

**Undercut/overcut viability** — When a close competitor pits, calculate:
- Their pit time loss (observed or estimated at ~25s for a full stop)
- Your pace advantage on fresh-vs-old tires (from tire degradation model)
- Projected gap when you eventually pit
- Net position change

This is the undercut/overcut decision: "Car ahead pitted. If you stay out 3 more laps, you'll overcut by 1.2 seconds — enough to jump them."

**Caution pit logic** — When a yellow flag drops, immediately calculate: "Free pit stop available — pitting now loses 8 seconds under caution vs. 25 seconds under green. Recommend pit." Factor in wave-by rules (if we're off the lead lap, pit road may close).

**What It Tells the Driver:**
- "Car ahead just pitted from P4. Stay out 2 more laps and you'll leapfrog them"
- "Yellow flag! Pit now — this is a free stop, everyone else will too"
- "Optimal pit window: laps 22-25. Earlier burns tire life, later risks fuel"
- "Verstappen hasn't pitted yet — he's on a 1-stop, you're on a 2-stop. Don't panic about the gap"


### 4. Corner Performance Analyzer

**The Problem:** CrewChief doesn't tell you *which* corner you're slow in. Coach Dave tells you after the race. Neither tells you in real time. This is the single most valuable thing a race engineer can do during a session: "You're losing 0.3 seconds in Turn 6, it's a throttle application issue."

**What We Already Have:**
- `TrackPositionPct` (0-1) — continuous track position
- `SectorSplitS1/S2/S3` and `SectorDeltaS1/S2/S3` — three-sector granularity
- Track map CSV data with turn names and positions
- `LapDeltaToBest` — real-time delta to personal best (but only as a single number, not per-corner)
- Full telemetry traces (throttle, brake, speed, G-forces, steering)

**What We'd Build:**

**Mini-sector system** — Divide the track into N segments (20-40 depending on track length) based on track position percentage. For each mini-sector, record:
- Entry time (when `TrackPositionPct` crosses the boundary)
- Exit time
- Mini-sector duration
- Peak speed, min speed, peak lateral G
- Throttle/brake application patterns (simplified: time-on-brake, time-on-throttle, max brake pressure)

After 3+ laps, compute personal best for each mini-sector. On subsequent laps, show per-corner delta.

**Corner classification** — Using the track map CSV turn data (which already has turn names and positions), map mini-sectors to named corners. This gives us "You're 0.2s slow in Maggotts-Becketts" instead of "mini-sector 14 is slow."

**Root cause heuristics** — When a corner is slow, classify why:
- **Late braking → fast entry → slow mid-corner**: Entry speed too high (understeer). "Brake earlier into Turn 6"
- **Early braking → slow entry → slow exit**: Over-braking. "You're braking too early into Turn 6 — carry 5 more km/h"
- **Good entry → slow exit**: Throttle application issue. "Getting on throttle 0.2s late out of Turn 6"
- **Good entry → good exit → slow between**: Minimum speed too low. "Tighten the line at the apex of Turn 6"

This doesn't require ML — it's pattern matching on brake/throttle traces compared to personal best. Compare the *shape* of the inputs in the slow mini-sector vs. the best mini-sector.

**Consistency scoring** — Track lap-to-lap variance per corner. High variance corners are where the driver is inconsistent and has the most to gain. "Your biggest inconsistency is Turn 3 — you vary by 0.4s there."

**What It Tells the Driver:**
- "You're losing 0.3s in Copse — late on throttle at exit. Best lap you were full throttle by 68%, this lap it was 74%."
- "Sector 2 is your weak sector today — 0.5s off your best. Turns 7 and 9 are the culprits."
- "Consistency alert: Turn 3 variance is 0.4s lap-to-lap. Focus on a repeatable line."
- "New personal best in Maggotts! You found 0.15s by carrying more speed through the left."


### 5. Opponent Intelligence

**The Problem:** You can see gaps on the leaderboard, but you can't see *why* those gaps are changing. Is the car behind catching you because they're faster, or because you hit traffic? Is the car ahead pulling away, or did they just get a good run out of a slow corner?

**What We Already Have:**
- Full leaderboard: position, iRating, best lap, last lap, gap to player, pit status
- `CarIdxLapDistPct[]` — real-time track position for every car
- `CarIdxOnPitRoad[]` — pit status
- `CarIdxLapCompleted[]` — lap count

**What We'd Derive:**

**Pace profile per driver** — Track each opponent's last-N lap times (already started with spark history in leaderboard.js, limited to 12 laps). Extend this server-side to the full race. Compute:
- Rolling average pace (last 5 laps, excluding outliers from pit laps and incidents)
- Pace trend (improving, stable, degrading — linear regression on recent laps)
- Best-case pace (fastest clean lap in current stint)

**Gap trend projection** — For the car directly ahead and behind:
- Current gap
- Gap change per lap (is it closing or opening?)
- Projected laps until catch/caught (linear extrapolation from gap trend)
- "Threat level": how many laps until the car behind is within DRS/overtaking range (<0.5s)

**Driver behavior classification** — Over multiple laps, classify each nearby opponent:
- **Pace consistency**: standard deviation of lap times. Low = robot, high = error-prone
- **Stint pattern**: when do they pit? Are they on the same strategy as you?
- **Incident rate**: if we can observe position changes and off-tracks (sudden gap jumps), flag aggressive/risky drivers
- **iRating context**: a 6k driver behind you is a bigger threat than a 2k driver

**Sector-level opponent comparison** — If we build the mini-sector system (module 4), we can compare sector times against opponents. This tells us *where* on track we're stronger or weaker vs. a specific rival, which informs overtaking and defending:
- "You're faster in Sector 1 but they pull 0.3s back in Sector 3 — defend into the Sector 3 braking zone"

**What It Tells the Driver:**
- "Car behind (Norris, 7.6k iR) is 0.3s/lap faster — he'll be on you in 4 laps"
- "Car ahead has pitted and is on fresh tires — expect them to be fast for the next 5 laps"
- "The guy in P6 is on a 1-stop and hasn't pitted — he'll fall back once he does"
- "You're faster than Leclerc in Sector 1 — set up your move there"


### 6. Race Position Projector

**The Problem:** Where will you finish? Not "what position are you now" but "if things continue as they are, where do you end up?" And more importantly: "what would change that?"

**What We Already Have:**
- Full leaderboard with gaps
- Pit status for all cars
- Pace data (from module 5)
- Our own fuel/tire state (from modules 1 and 2)

**What We'd Derive:**

**Race projection model** — A simplified Monte Carlo-ish projection. For each car:
- Current position and gap to player
- Estimated remaining pit stops (based on observed strategy and fuel/tire estimates)
- Pace trend extrapolated to end of race

Project positions at race end under current conditions. This gives a "predicted finish" that updates lap by lap.

**"What-if" scenarios** — Compute a handful of key alternatives:
- "If you pit next lap vs. in 5 laps"
- "If the yellow comes out in the next 10 laps"
- "If you can find 0.2s per lap in Sector 2"

These don't need to be perfect — directional is valuable. A race engineer doesn't compute exact outcomes, they give the driver a mental model.

**What It Tells the Driver:**
- "Projected finish: P6. P5 is within reach if you can close 0.2s/lap on Piastri."
- "Everyone ahead has pitted — you're P3 on track but P7 on strategy. After your stop you'll slot in around P6."
- "If a caution comes in the next 5 laps and you pit, you jump to P4."
- "iRating impact: P6 finish = +45 iR. P4 = +120 iR. The fight for P5 is worth it."


### 7. Setup Feedback Loop

**The Problem:** Mid-session adjustment decisions (brake bias, TC, ARB, wing, fuel mix) are usually made by feel. The strategist should be able to suggest adjustments based on what the telemetry is showing.

**What We Already Have:**
- `BrakeBias`, `TractionControlSetting`, `AbsSetting`, `ArbFront`, `ArbRear`, `WingFront`, `WingRear`, `FuelMixture`, `WeightJackerLeft/Right`
- `HasTC`, `HasABS`, `HasARBFront`, etc. — availability flags per car
- `AbsActive`, `TcActive` — current activation state
- All G-force, steering, yaw rate data for balance detection

**What We'd Derive:**

**Balance trend** — Track understeer/oversteer balance across a stint:
- Understeer score: high steering angle + low yaw rate + ABS activation at corner entry
- Oversteer score: TC activation at corner exit + sudden yaw rate spikes + countersteering
- If balance shifts toward understeer over a stint (common as fronts wear), suggest: "Fronts wearing — consider 0.5% rear bias or +1 front ARB"

**TC/ABS activation frequency** — If TC activates more than X times per lap (threshold varies by car), suggest reducing TC sensitivity or adjusting throttle maps. Same for ABS — frequent activation at corner entry may indicate brake bias is too far forward.

**What It Tells the Driver:**
- "Understeer increasing — brake bias is at 56.5%, try 56.0%"
- "TC activating 8 times per lap out of slow corners. You might gain time with TC at 4 instead of 5."
- "Rear tire temps are 8 degrees hotter than fronts — consider +1 click rear ARB to reduce rear loading"

---

## Architecture

### Where It Runs

All strategy computation runs **server-side in Plugin.cs** (C#), not in the dashboard JavaScript. The dashboard is a display layer. The strategy modules are new engine components alongside `CommentaryEngine`, `SectorTracker`, and `TrackMapProvider`.

```
Plugin.cs
  |
  |-- TelemetrySnapshot.Capture()      [every frame]
  |-- CommentaryEngine.Update()         [existing triggers]
  |-- StrategyCoordinator.Update()      [NEW - runs every frame]
  |       |
  |       |-- TireTracker.Update(snapshot)
  |       |-- FuelComputer.Update(snapshot)
  |       |-- PitOptimizer.Update(snapshot, opponents)
  |       |-- CornerAnalyzer.Update(snapshot)
  |       |-- OpponentIntel.Update(snapshot, opponents)
  |       |-- RaceProjector.Update(snapshot, opponents)
  |       |-- SetupAdvisor.Update(snapshot)
  |       |
  |       |-- PrioritizeAndEmit()       [pick highest-priority call]
  |
  |-- HTTP API exposes strategy state
  |-- Dashboard renders strategy panel
```

### Integration with Commentary System

Strategy calls should flow through the existing commentary pipeline but with a new category — `strategy` — that has its own color (perhaps a warm amber, distinct from flag colors) and sentiment. Strategy calls compete with event commentary via the same severity system:

- Severity 1: Background info ("Tire wear at 40%")
- Severity 2: Actionable insight ("Pit window opens in 3 laps")
- Severity 3: Urgent recommendation ("Pit now — caution is out, free stop")
- Severity 4-5: Critical ("You will run out of fuel in 2 laps")

The cooldown system prevents strategy spam — e.g., a "pit window" call shouldn't repeat more often than every 3 laps unless the situation changes materially.

### New Data Structures

**Per-Stint State:**
```csharp
class StintData {
    int StartLap;
    double StartFuel;
    double[] WearPerLap;        // [FL,FR,RL,RR] wear delta per lap
    double[] FuelPerLap;        // consumption per lap
    double[] LapTimes;          // raw lap times this stint
    double[] PeakLatG;          // peak cornering G per lap
    int TCActivations;          // total TC fires this stint
    int ABSActivations;         // total ABS fires this stint
}
```

**Per-Opponent State:**
```csharp
class OpponentProfile {
    string Name;
    int IRating;
    double[] RecentLaps;        // last N lap times
    int PitStopCount;
    int LastPitLap;
    double AvgPace;             // rolling 5-lap average
    double PaceTrend;           // slope of pace regression
    double GapToPlayer;
    double GapTrend;            // change per lap
}
```

**Mini-Sector Data:**
```csharp
class MiniSector {
    double StartPct;            // track position start
    double EndPct;              // track position end
    string TurnName;            // from track map CSV, or null
    double BestTime;            // personal best for this mini-sector
    double LastTime;            // most recent
    double[] History;           // last N attempts
    double Variance;            // consistency metric
}
```

### Dashboard Display

The strategy module needs dashboard real estate. Options:

**Option A: Integrated into commentary panel.** Strategy calls appear as commentary messages with the `strategy` category color. No new UI, minimal dashboard changes. Simplest to implement.

**Option B: Dedicated strategy strip.** A thin bar below or beside the leaderboard showing the current top-priority strategy insight, a fuel/tire summary, and a projected finish position. More informative but requires new layout.

**Option C: Strategy overlay mode.** A togglable mode that replaces the datastream panel with a full strategy dashboard (tire life gauges, fuel projection graph, pit window timeline, opponent threat radar). Most powerful but most complex.

Recommendation: **Start with Option A**, graduate to Option B once the strategy data is proven useful. Option C is a long-term aspiration.

---

## What's Innovative Here

### 1. Real-time corner-level coaching during the race

Nobody does this in real time. CrewChief tells you sector-level deltas. Coach Dave and VRS show corner-level data *after* the session. We'd be the first to say "You lost 0.3s in Copse, you braked too early" *while you're still racing*. The mini-sector system combined with root-cause heuristics makes this possible without ML — it's pattern matching against your own personal best.

### 2. Opponent strategy inference

Nobody infers opponent pit strategy from observation and projects race outcomes. We have `CarIdxOnPitRoad[]` and lap data for every car. By tracking who has pitted and when, we can infer whether each car is on a 1-stop, 2-stop, or fuel-saving strategy, and project where everyone will end up. This is exactly what F1 pit wall strategists do, but automated.

### 3. Grip degradation as a composite metric

Most tools show raw tire wear numbers. We'd synthesize wear + temps + peak G degradation + ABS/TC frequency + understeer index into a single "grip health" score that's more actionable than any individual number. The fuel-weight correction removes a major confound that makes raw lap time trends misleading.

### 4. Caution-aware pit strategy

When a yellow flag drops, the strategist should instantly compute whether to pit. This requires knowing your fuel state, tire state, position, and what a "free" pit stop is worth. No sim racing tool currently does this kind of instant caution-triggered recommendation.

### 5. The race engineer voice

All of this data is useless if it's presented as numbers on a screen. The real innovation is *how* it's communicated — through the commentary system, in natural language, with appropriate urgency. "Stay out two more laps, then pit. Norris will be behind you when you come out." That's a race engineer, not a dashboard.

---

## Implementation Priority

| Phase | Module | Effort | Impact |
|-------|--------|--------|--------|
| **1** | Fuel Strategy Computer | Medium | High — most requested feature, clear data path |
| **1** | Tire Lifecycle Tracker | Medium | High — wear data already available, just needs trending |
| **2** | Opponent Intelligence | Medium | High — leaderboard data already there, needs server-side history |
| **2** | Pit Strategy Optimizer | High | Very High — depends on modules 1, 2, and competitor tracking |
| **3** | Corner Performance Analyzer | High | Very High — the flagship differentiator, needs mini-sector system |
| **3** | Race Position Projector | Medium | Medium — directional value, depends on opponent intel |
| **4** | Setup Feedback Loop | Low | Medium — mostly heuristic-based on existing data |

Phase 1 is achievable in weeks with the existing data pipeline. Phase 2 adds the multi-car awareness. Phase 3 is the hard, differentiating work — the mini-sector system is the core investment. Phase 4 is polish.

---

## Data Gaps and Open Questions

**Things we'd need to figure out:**

1. **Pit lane time loss** — We don't directly measure this. We can estimate it from `PitSpeedLimitKmh` and approximate pit lane length, or calibrate by observing our own pit stops (detect `IsInPitLane` entry/exit, measure elapsed time).

2. **Fuel weight sensitivity** — How much does fuel weight affect lap time per car? This is car-specific and not exposed by SimHub. We'd need to either maintain a lookup table per car, or estimate it from the relationship between fuel level and lap time early in a stint (before tire deg dominates).

3. **Mini-sector boundaries** — Ideally these are defined per-track to align with corner apexes. The track map CSVs already have turn positions, so we could anchor mini-sectors to known corners. For unmapped tracks, equal divisions of `TrackPositionPct` are a reasonable fallback.

4. **Multi-class awareness** — In multi-class races, opponent pace comparisons need to account for car class. We'd need to detect class (from car model or iRating clustering) and only compare within class.

5. **Full opponent leaderboard** — Currently `BuildLeaderboard()` returns the full field but the dashboard only shows a window. The strategy module needs the full array for race projection. The server-side data is already there, just needs to be stored for the strategy coordinator rather than discarded after JSON serialization.

6. **Historical data across sessions** — The most powerful version of this system would learn track-specific fuel burn, tire wear rates, and sector times across multiple sessions. The telemetry recording system (now writing to `racecorprodrive-data/recordings/`) could serve as a foundation for this — replay past recordings to bootstrap the models.

---

## Competitive Positioning

| Capability | CrewChief | Coach Dave | VRS | K10 Strategist |
|-----------|-----------|------------|-----|----------------|
| Fuel monitoring | Basic | No | No | Predictive |
| Tire state | Temps only | Post-race | Post-race | Real-time composite |
| Corner coaching | No | Post-race | Post-race | **Real-time** |
| Opponent tracking | Gap only | No | No | Strategy inference |
| Pit timing | No | No | No | **Optimized** |
| Caution strategy | No | No | No | **Instant** |
| Setup advice | No | Post-race | Post-race | **Live heuristics** |
| Race projection | No | No | No | **Live** |

The strategic niche: **real-time, data-driven race engineering that nobody else does live.** CrewChief is the closest competitor but it's a monitor, not a strategist. Coach Dave and VRS are the closest in analytical depth but they're post-session tools. We'd be the first to bring pit-wall-level strategy to the cockpit in real time.
