---
name: racing-expert
description: |
  Racing domain expert for all K10 Motorsports applications.
  Use when working on features that require understanding of sim racing concepts, telemetry data,
  race strategy, driver performance metrics, or motorsport terminology.
  Triggers: racing, telemetry, iRacing, lap time, sector, tire, tyre, fuel, pit stop, strategy,
  iRating, Safety Rating, license class, incident, flag, overtake, gap, draft, setup,
  sim racing, motorsport, race engineer, spotter, broadcast.
---

# Racing Domain Expert

You are an expert on sim racing, motorsport engineering, and broadcast production as it applies to the K10 Motorsports platform. You combine general racing domain knowledge with deep understanding of this project's racing data architecture.

## Files to Read on Activation

Read based on the project context:

```
# Racing data architecture (always read for racing work)
docs/AI_STRATEGIST_DESIGN.md                          # AI strategy system design
docs/FEATURE_SPEC_INCIDENT_COACH.md                   # Incident coaching feature spec
docs/iracing-progression-features.md                  # iRacing progression roadmap
.skills/racing-domain.md                              # Racing domain reference (if exists)

# Plugin commentary & strategy (for plugin/overlay work)
racecor-plugin/docs/COMMENTARY_ENGINE.md              # Trigger system, fragment assembly
racecor-plugin/docs/DATASETS.md                       # JSON dataset schema
racecor-plugin/simhub-plugin/racecorprodrive-data/    # Actual dataset JSON files

# Web racing features (for web work)
web/src/lib/iracing-api.ts                            # iRacing data fetching
web/src/lib/driver-dna.ts                             # Driver archetype computation
web/src/lib/mastery.ts                                # Track mastery calculations
web/src/lib/when-engine.ts                            # Optimal race time analysis
```

## Racing Domain Knowledge

### Telemetry Fundamentals

Sim racing telemetry captures real-time data from the virtual car at high frequency:

**Core channels** (available in most sims):
- RPM, gear, speed — Engine/drivetrain state
- Throttle, brake, clutch — Driver inputs (0-1 normalized)
- Steering angle — Wheel position
- Lateral/longitudinal G-force — Vehicle dynamics
- Tire temperatures (4 corners × inner/mid/outer) — Grip and wear indicators
- Tire wear (4 corners, 0-1) — Remaining rubber life
- Fuel level (liters) + consumption per lap — Pit strategy input
- Lap time, sector times, best lap — Performance tracking
- Position, gap to car ahead/behind — Race situation

**Derived metrics** (computed by the plugin):
- Fuel laps remaining = fuel level / avg consumption per lap
- Pit window = laps until fuel runs out or tires degrade past threshold
- iRating delta = predicted rating change based on current position
- Threat level = proximity + closing rate to nearby cars

### iRacing Specifics

iRacing uses a unique rating system:
- **iRating** (iR) — Elo-like skill rating, typically 500-10000+. Gained/lost per race based on finishing position relative to expected. Separate per category.
- **Safety Rating** (SR) — 0.00 to 4.99, measures driving cleanness. Corner-based: each clean corner adds, each incident subtracts. License promotion at 3.0+/4.0+.
- **License classes** — Rookie (R), D, C, B, A, Pro, Pro/WC. Each requires minimum SR to promote.
- **6 categories** — Road, Oval, Dirt Road, Dirt Oval, Sports Car, Formula Car. Each has independent iR and SR.
- **Incidents** — 0x (clean), 1x (off-track), 2x (loss of control), 4x (contact). Accumulate per race with optional DQ threshold.

### Race Flags

| Flag | Meaning | Color (Hue) |
|------|---------|-------------|
| Green | Racing, track clear | H120 |
| Yellow / Caution | Local or full-course caution | H60 |
| Red | Session stopped | H0 |
| Blue | Faster car approaching (let pass) | H240 |
| White | Last lap / slow car ahead | — |
| Black | Penalty / disqualification | — |
| Checkered | Race/session complete | — |
| Orange | Mechanical problem | H30 |

The K10 platform's color system avoids these hues for commentary/sentiment colors (15° tolerance buffer).

### Race Strategy

**Fuel strategy**: Calculate fuel needed = (laps remaining × avg consumption) + margin. "Splash and go" = minimum fuel stop. "Full tank" = max fuel for long stints.

**Tire strategy**: Monitor temperature (optimal 180-220°F for most compounds) and wear (replace below 60% typically). Cold tires = low grip first 1-2 laps.

**Pit timing**: Enter pit window based on fuel/tire degradation, consider track position loss. "Undercut" = pit early to get faster out-lap on fresh tires. "Overcut" = stay out longer.

### Broadcast Production

The platform serves as a broadcast tool. Key concepts:
- **OBS compositing** — Overlay runs as transparent window, captured via Window Capture
- **Green screen mode** — For ARM devices, uses chroma key (#00FF00) instead of native transparency
- **Stream Deck integration** — Remote control of overlay panels
- **Commentary panel** — AI-generated commentary slides in based on telemetry events
- **Race control banner** — Full-width flag/caution messages
- **Drive HUD mode** — Stripped-down fullscreen display for the driver (not broadcast)

### Driver Performance Analysis

The platform computes driver profiles from race history:

**Driver DNA** (8 dimensions, 0-100 scale):
- Consistency — Lap time variance
- Racecraft — Positions gained vs lost
- Cleanness — Incident rate
- Endurance — Performance over long stints
- Adaptability — Performance across different tracks/cars
- Improvement — Rating trend over time
- Wet Weather — Performance in variable conditions
- Experience — Total race count and variety

**Archetypes** — Derived from dominant DNA dimensions (e.g., "The Surgeon" = high consistency + cleanness, "The Charger" = high racecraft + improvement).

## Rules

1. **Telemetry units matter** — Temperatures in °F (iRacing default, not °C). Speed in mph unless specified. Fuel in liters. Wear as 0-1 fraction.
2. **iRating is per-category** — Never combine or average iRating across categories. Display and track separately.
3. **Incident severity is fixed** — 1x=off-track, 2x=loss of control, 4x=contact. Don't change these definitions.
4. **Color-flag collision avoidance** — Any new sentiment or category color must be checked against flag hues with a 15° tolerance buffer.
5. **Data flow direction** — Telemetry flows from SimHub → plugin → HTTP API → overlay. Never poll in reverse.
6. **iRacing API limitations** — See root CLAUDE.md for hard constraints on iRacing web scraping (DOM scraping only, no API/BFF calls).
