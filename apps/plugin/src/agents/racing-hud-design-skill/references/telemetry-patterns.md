# Telemetry Visualization Patterns for Racing HUDs

## Table of Contents
1. Tachometer / RPM Display
2. Pedal Input Visualization
3. Tire Temperature and Wear
4. Fuel State and Strategy
5. G-Force / Acceleration
6. Track Map Design
7. Lap Timing and Delta
8. Leaderboard and Gap Displays
9. Race Timeline / Position History
10. Weather and Track Conditions
11. Shift Lights and Alerts
12. Steering and Car Setup

---

## 1. Tachometer / RPM Display

The tachometer is the most-glanced instrument in racing. It must be readable in peripheral vision
without dedicated focus.

**Patterns ranked by glanceability:**

1. **Linear segmented bar** (best for HUDs) — horizontal or vertical strip that fills left-to-right
   or bottom-to-top. Color zones (green → yellow → red) make the RPM band visible peripherally.
   The fill level is the data; color zones add shift-point awareness. Used by F1 steering wheels,
   most SimHub dashboards, and modern racing games.

2. **Shift light LEDs** — a row of dots/circles that illuminate progressively. Extremely peripheral-
   friendly because they encode RPM as a spatial pattern. Often paired with a bar or arc.
   The classic pattern: 3 green → 2 yellow → 2 red → full blue flash at shift point.

3. **Arc/sweep gauge** — traditional semicircular or partial-arc tachometer. Familiar from road cars
   but less space-efficient than a bar. The angular position of the needle is readable, but smaller
   arcs (90°–180°) work better on HUDs than full 270° sweeps.

4. **Numeric RPM** — just the number. Least glanceable for trend/zone awareness but most precise.
   Best used as a supplement to a visual gauge, not a replacement.

**Anti-patterns:**
- Full circular gauges that waste space on a rectangular screen
- RPM displayed only as a number with no visual fill
- Tach bars that don't use color zones (a monochrome bar requires reading the exact position)
- Overly smooth gradients instead of distinct color zones (green/yellow/red should have clear
  transitions, not a seamless blend that makes the current zone ambiguous)
- WebGL bloom/glow effects on the tach that add visual weight without data — if the color zone
  already encodes the RPM band, a glow just adds noise

**Encoding efficiency:**
The ideal tach encodes three things simultaneously: current RPM (bar position), RPM zone (bar color),
and approaching-redline urgency (how close the fill is to the end). Three data dimensions in one
visual element — very high data-ink ratio.

---

## 2. Pedal Input Visualization

Pedal traces show driver inputs and are valuable for both real-time feedback and coaching.

**Patterns:**

1. **Vertical bars** — one each for throttle (green), brake (red), and optionally clutch (blue).
   Height = current input percentage. The most compact option and readable in peripheral vision.
   The bars should be adjacent for comparison and consistently ordered (left-to-right: throttle,
   brake, clutch).

2. **Histogram / time-series trace** — a rolling chart showing the last N samples of pedal input
   over time. Shows patterns like threshold braking, trail braking smoothness, and throttle
   application on corner exit. More useful for coaching than real-time driving, but some drivers
   glance at the shape to check their technique.

3. **Response curve overlay** — shows the input-to-output mapping (pedal position → brake pressure
   or throttle percentage after any assists). Useful for setup work, not useful during racing.

4. **Combined pedal+speed trace** — the broadcast standard. Shows throttle and brake as mirrored
   areas (throttle above center, brake below) with a speed line overlaid. This is an analysis
   tool, not a driving tool — requires sustained attention to read.

**What works:**
- Consistent color coding: green = throttle, red = brake, blue = clutch is nearly universal
- Percentage labels next to or above the bars
- Rolling trace with a trailing history (last 15–20 samples) that shows input shape

**What doesn't work:**
- Pedal bars without percentage labels (the bar alone isn't precise enough for setup work)
- Traces that are too short (< 10 samples) to show a meaningful pattern
- Clutch trace always visible when the car has no clutch pedal (wastes space; hide it contextually)

---

## 3. Tire Temperature and Wear

Tire data is complex — four tires, each with temperature and wear, some with inner/middle/outer
temperature readings. The challenge is showing 8–24 data points without requiring the driver to
study a table.

**Patterns:**

1. **2x2 grid with color-coded values** — the standard. Four cells arranged in the physical layout
   of the tires (FL, FR top; RL, RR bottom). Temperature shown as text, cell background colored
   from cool (blue) → optimal (green) → hot (red/amber). The spatial layout means the driver
   instantly knows which tire is which.

2. **Heat map cells** — same 2x2 layout but with three columns per tire for inner/middle/outer
   temperature. Creates a 2x6 grid. Only useful for setup analysis, not real-time driving.

3. **Wear bars** — thin progress bars below each tire cell showing remaining tire life as a
   depleting fill. Green at 100% → yellow at ~40% → red below 20%.

4. **Compound indicator** — a badge or color showing the tire compound (soft/medium/hard or
   specific compound names). Important in multi-compound races.

**Critical design guidance:**
- Always arrange in the physical layout (FL top-left, FR top-right, RL bottom-left, RR bottom-right)
- Include a reference for the color scale — what temperature is "green"? Without this, the colors
  are arbitrary to anyone who doesn't know the specific car's tire model
- Wear and temperature are related but different — don't combine them into one encoding. Show both
  with clear separation
- Temperature values should show degrees with the unit (°F or °C) — units matter because iRacing
  defaults to Fahrenheit while many other sims use Celsius

---

## 4. Fuel State and Strategy

Fuel is a time-critical resource. The display must answer three questions at a glance:
1. How much fuel do I have? (current level)
2. How far will it go? (estimated laps remaining)
3. Do I need to pit? (will I make it to the end?)

**Patterns:**

1. **Fuel bar + numeric** — a horizontal or vertical bar showing fuel level, with the numeric value
   (liters or gallons) beside it. Color transitions from green (plenty) → amber (getting low) →
   red (pit now). The bar provides the trend/shape, the number provides precision.

2. **Fuel consumption stats** — "Avg 3.12 L/lap" and "Est 9.1 laps" as supplementary text. These
   are the most actionable numbers — they pre-compute the math the driver would otherwise do.
   Always show these; the raw fuel level alone forces mental math.

3. **Fuel delta / surplus** — "+2.3 laps over minimum" or "-1.1 laps short" tells the driver
   whether they can push or need to save. Color-coded: green = surplus, red = deficit.

4. **Pit window indicator** — a marker on the fuel bar or a separate label showing "PIT IN 3 LAPS"
   or "MUST PIT THIS LAP" at the appropriate threshold. This is the most critical fuel display —
   missing a pit window can end a race.

**What works:**
- Pre-computed "estimated laps remaining" prominently displayed
- Clear pit window callout with color urgency
- Fuel bar that's at least 80px wide (tiny bars are hard to read)

**What doesn't work:**
- Showing only liters remaining with no consumption context
- Multi-hue color gradient (green → amber → red) that creates ambiguous boundaries — consider
  a single-hue bar with a threshold marker instead
- Fuel data buried in a tertiary position when fuel strategy is race-critical

---

## 5. G-Force / Acceleration

G-force visualization shows the car's lateral and longitudinal acceleration, revealing grip limits,
driving smoothness, and car balance.

**Patterns:**

1. **G-circle (dot plot)** — a circle with a dot representing current G-force position (X = lateral,
   Y = longitudinal). The dot traces the car's grip envelope. Simple, compact, and shows combined
   G in both axes simultaneously. Often includes a fading trail of recent positions.

2. **Yaw rate waveform** — a time-series trace of rotational velocity. Shows oversteer/understeer
   events as spikes. More analytical than real-time useful, but drivers who study driving style
   benefit from seeing the pattern.

3. **Numeric G values** — lateral and longitudinal G as numbers. Least intuitive but most precise.
   Best as a supplement to the G-circle.

**Design notes:**
- The G-circle should be oriented from the driver's perspective (right = right turn, up = braking)
- A reference circle showing 1G or the car's typical max G provides context
- Trail length of 20–40 samples creates a useful shape without cluttering
- Color the trail by intensity or age (brightest = current, fading = older)
- Keep it small — G-force is tertiary information during racing

---

## 6. Track Map Design

The track map shows the player's position on the circuit, plus optionally other cars, sector
boundaries, and event markers.

**Patterns:**

1. **Static full-track** — the entire track outline visible at all times, with a dot for the player.
   Works best when the track shape is recognizable and the map is large enough (~80x80px minimum).

2. **Heading-up rotation** — the track map rotates so the player's direction is always "up."
   More intuitive for situational awareness (you see what's ahead of you at the top) but can be
   disorienting on complex circuits.

3. **Minimap (fixed orientation)** — track stays oriented with north/start at top. Less intuitive
   moment-to-moment but better for understanding overall position on the circuit.

**Design notes:**
- Player dot should be the brightest, largest element. 2–3x the size of opponent dots.
- Opponent dots should be muted but visible — don't clutter the track outline
- Sector boundaries should be subtle lines or color changes on the track path, not heavy markers
- The track outline should be a thin, low-contrast stroke. The dots are the data; the track is context
- Track name or corner names can appear as very subtle labels for broadcast; omit for driver HUDs
- SVG is the ideal format — scales cleanly, no pixelation at any zoom
- If the track data comes from the sim, handle edge cases: incomplete data, very short tracks,
  oval tracks where the outline is nearly circular

**Anti-patterns:**
- Glow effects on the player dot (adds visual weight without data)
- Track outline thicker than necessary (it's reference geometry, not data)
- Missing sector boundaries (the driver needs to know which sector they're in)
- No indication of pit lane entry/exit

---

## 7. Lap Timing and Delta

Lap timing is arguably the most important data in racing — it's how you know if you're fast.

**Delta-to-best** is the king metric. It shows, in real-time, how the current lap compares to the
best lap. Positive = slower, negative = faster.

**Patterns:**

1. **Live delta number** — "+0.347" or "−0.512" updating in real-time. Color-coded: green = gaining
   time, red = losing time, white/neutral = within a small threshold. The most important number on
   any driver HUD after gear.

2. **Delta bar** — a horizontal bar that fills left (faster) or right (slower) from center. Provides
   a visual sense of magnitude. Works well paired with the numeric delta.

3. **Sector times** — S1, S2, S3 (or more) showing completed sector times. Color: green = personal
   best, purple = overall best, yellow = slower than personal best, white = no comparison. The
   F1 color convention (purple > green > yellow) is widely understood.

4. **Last lap / best lap** — static values for reference. Less urgent than live delta but useful
   for context.

**Design notes:**
- Delta should use a monospaced or tabular-figure font — the +/− sign and decimal point must stay
  fixed as the value changes, or the number visually "jumps"
- Update rate matters: delta that updates every 100ms feels connected to the driving; every 1s
  feels laggy and disconnected
- Sign convention: always show the sign (+/−). A number like "0.347" with no sign is ambiguous
- Magnitude encoding through color saturation (barely green for −0.050, vivid green for −1.500)
  helps the driver gauge how much faster/slower without reading the exact number

---

## 8. Leaderboard and Gap Displays

The leaderboard shows the competitive picture — who's ahead, who's behind, and by how much.

**For driver HUDs:** Show only the cars immediately relevant:
- Car directly ahead (name/number + gap)
- Car directly behind (name/number + gap)
- Optionally: leader (if not the car ahead)
- Total position ("P4 / 22")

**For broadcast overlays:** Full leaderboard is expected and useful:
- All cars, ordered by position
- Gap to leader or gap to car ahead
- Tire compound indicator
- Pit stop count
- Inline sparklines showing recent lap time trend (a Tufte-approved pattern)
- Team/driver colors for identification

**Patterns:**

1. **Compact gap display** — just the car ahead and behind with gap times. Most glanceable for
   drivers. Layout: car name on top, gap time below, color-coded (green if gap shrinking,
   red if growing).

2. **Scrolling leaderboard** — full field in a vertical list. Can be long; consider showing only
   the region around the player (3 above, 3 below) with an option to expand.

3. **Gap bars** — visual bars showing gap magnitude. Intuitive but space-hungry.

**Design notes:**
- Gaps should show absolute time ("+1.3s") not distance
- Include iRating/license class when relevant (helps the driver judge competitor quality)
- Driver names should be abbreviated if space is tight (last name or 3-letter code)
- Sparklines in the leaderboard are excellent — they show whether a competitor is getting faster
  or slower without needing to remember previous lap times

---

## 9. Race Timeline / Position History

A compact visualization of how the race has unfolded — position changes over time.

**Patterns:**

1. **Heat-mapped strip** — a thin horizontal bar where each segment represents a lap or time slice.
   Color encodes position change: green = gained positions, blue = neutral, red = lost positions,
   gold = in P1. Event markers (pits, incidents) overlay as dots or lines. Very high information
   density.

2. **Position chart** — a traditional line chart with laps on X-axis and position on Y-axis
   (inverted, so P1 is at top). Shows the full arc of the race. Better for post-race analysis
   than real-time — too complex to glance.

3. **Position number history** — a row of small position numbers or badges showing P3→P3→P2→P1→P1.
   Low density but simple.

**The heat-mapped strip is the best real-time pattern** — it's essentially a sparkline of position
changes. It encodes the shape of the race in a tiny space and requires no axis labels.

---

## 10. Weather and Track Conditions

Critical for strategy — wet conditions change everything about tire choice and driving approach.

**What to show:**
- Track temperature (affects tire grip windows)
- Air temperature
- Rain probability or current rainfall
- Track state (dry / damp / wet / flooded)
- Wind speed and direction (relevant at some circuits)

**Design notes:**
- Weather data updates slowly (minutes, not seconds) — it can live in a tertiary position
- Use standard weather iconography (sun, cloud, raindrop) rather than text labels
- Track temperature matters more than air temperature for tire strategy — give it more prominence
- Combine with tire temperature display when possible (context: "track is 45°C and your tires
  are overheating" is a meaningful correlation)

---

## 11. Shift Lights and Alerts

Shift indicators are the most time-critical element — missing a shift costs RPM, time, and
potentially engine damage.

**Patterns:**
- LED strip that fills progressively (most common and effective)
- Full-screen flash at shift point (impossible to miss, but can be startling)
- Numeric RPM turning red/flashing at shift point
- Audio cue (outside the visual HUD, but often the most effective shift indicator)

**Alert hierarchy:**
1. Shift indicator (every lap, multiple times)
2. Flag changes (session-critical)
3. Damage / mechanical failure (race-critical)
4. Pit window / fuel critical (strategy-critical)
5. Incident count warnings (penalty risk)
6. Position changes (competitive awareness)

Alerts should use different visual treatments by severity — don't use the same animation/color
for "you've moved up one position" and "your engine is on fire."

---

## 12. Steering and Car Setup

**Brake bias, traction control, ABS** — these are adjustable during driving and need clear displays.

**Patterns:**
- Compact numeric display with label: "BB 56.2%" / "TC 4" / "ABS 3"
- Thin vertical fill bars behind the numbers showing the relative position in the adjustment range
- Flash/highlight on value change so the driver confirms the adjustment took effect

**Design notes:**
- Not all cars have adjustable TC/ABS — hide these controls when they don't apply
- Brake bias is shown as a percentage (front bias). The number alone is sufficient; a bar adds
  little because the range is typically narrow (52–62%)
- Map adjustments should be labeled clearly — "MAP 1" means nothing without context; "MAP 1: LEAN"
  or a fuel economy indicator is more useful
