# K10 Motorsports — Racing Domain Knowledge

## Driver Priorities (Information Hierarchy)

### Tier 1 — Always Visible, Largest Display
- **Position (P#)**: 44px, the single most emotionally important metric
- **Speed**: 28px, immediate car control feedback
- **Gear**: 96px, peripheral vision confirmation of transmission state
- **RPM**: Color-coded (green→yellow→red→redline pulse), engine protection
- **Fuel Level**: Bar + numeric, prevents DNF from starvation
- **Tyre Temps/Wear**: 4-cell grid, the primary performance variable

### Tier 2 — Tactical Racing
- **Lap Times (Current/Best)**: Purple for session best, personal bests in green
- **Gap Ahead/Behind**: Monospace, green=ahead red=behind, drives attack/defend decisions
- **iRating + Safety Rating**: Competitive ranking, gates race access
- **Current Lap**: Race progress reference

### Tier 3 — Advanced Telemetry (Datastream)
- **G-Force Diamond**: Canvas 64×64, lateral vs longitudinal
- **Steering Torque**: Understeer/oversteer indicator
- **Lap Delta**: Real-time pace vs best, ±2.5s range
- **Track Temp**: Context for tyre behavior
- **ABS/TC Active**: Boolean aids engagement flags
- **FPS**: Performance monitoring

### Tier 4 — Supplementary
- **Incidents**: Escalating color (green→red), penalty/DQ thresholds
- **In-Car Adjustments**: BB/TC/ABS with per-control hue coding
- **Pedal Histograms**: 20-sample step bars, smoothness feedback
- **Leaderboard**: Multi-car context for broadcasting

## Racing Concepts with Dedicated Modules
1. **Pit Limiter**: Fades all other modules to 25% opacity, shows speed in pit lane
2. **Race Control**: Banner takeover with animated flag-colored stripes, 50% dim
3. **Formation Lap**: Centered overlay, GetInCar→Warmup→Formation→Lights→Race
4. **Start Lights**: F1-style 5×2 red-to-green with GO! flash
5. **Spotter**: Non-blocking corner messages, proximity-based (danger <0.5s, warning <1.5s)
6. **Incidents**: Escalating severity with color progression and threshold bars

## iRacing Telemetry Architecture
- SessionState: 0=Invalid, 1=GetInCar, 2=Warmup, 3=ParadeLaps, 4=Racing, 5=Checkered, 6=Cooldown
- SessionFlags: Bitmask (0x0004=Green, 0x0008=Yellow, 0x0010=Red, 0x0020=Blue, etc.)
- PaceMode: 0=NotPacing, 1=Pacing, 2=Approaching, 3=FieldCrossSF
- CarIdxLapDistPct[]: Per-car track position for map rendering
- CarIdxOnPitRoad[]: Per-car pit status for gridded car counting

## Track Map CSV Data Quality

Track map CSVs (in `racecor-plugin/.../TrackMaps/`) contain WorldX, WorldZ,
LapDistPct columns recorded from iRacing telemetry. **Not all CSVs are clean.**

Known issues:
- **Interleaved recordings**: Some CSVs (e.g. Spa 2024) contain two overlapping
  track recordings with coordinates offset by ~1000+ units. Points alternate
  between the two groups when sorted by LapDistPct, creating zigzag SVG paths.
- **Zero-pct clusters**: Start/finish areas can have hundreds of points with
  LapDistPct=0.000000, which cluster randomly when sorted.
- **Sebring International**: Known clean dataset (2407 points, smooth consecutive
  distances). Used as the demo fallback track.

**Before using any track CSV for path generation:**
1. Check for bimodal coordinate distribution (two clusters in X or Z)
2. Verify average consecutive-point distance is reasonable (< 5 units)
3. Check for large jumps (> 20 units between consecutive sorted points)
4. Count zero-pct points — more than ~10 is a red flag

The C# `TrackMapProvider.NormaliseAndBuild()` normalizes to a 0-100 viewBox
with 5% padding: `scale = 90 / max(rangeX, rangeZ)`, offset by 5.

## Demo Sequence Design
- Starts with full pre-race: GetInCar(3s)→Warmup(4s)→Formation(12s)→Lights(~10s)→Race
- Start type chosen once at reset (rolling 60% / standing 40%), never switches mid-sequence
- Position cycles: P4→P3→P2→P1(gold)→hold→P2→P3→P4 over 10-lap cycle
- Car model cycles every 2 laps through 10 manufacturers
- In-car adjustments shift at specific lap positions to trigger commentary
- Formation repeats every 3 minutes during race simulation
