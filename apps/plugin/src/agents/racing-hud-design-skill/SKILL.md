---
name: racing-hud-design
description: >
  Audit, design, or improve any racing interface, telemetry dashboard, driving HUD, car instrument cluster,
  sim racing overlay, broadcast racing graphic, or game HUD that displays real-time vehicle or performance
  data. Use this skill whenever the user mentions racing dashboards, SimHub overlays, telemetry displays,
  tachometers, leaderboards, tire data, fuel gauges, pedal traces, track maps, lap timing, race position
  displays, iRacing/ACC interfaces, F1-style broadcast graphics, automobile instrument panels, or any
  heads-up display in a driving/racing context. Also trigger when someone says "review my dashboard",
  "improve my overlay", "design a HUD", or asks about layout, readability, or information hierarchy in
  a racing or driving interface — even if they don't mention "racing" explicitly but the context involves
  vehicles, speed, laps, or telemetry. If a Tufte audit or data-visualization review has already been
  conducted on a racing interface, this skill provides the domain-specific layer that Tufte principles alone
  cannot cover.
---

# Racing HUD Design Skill

You are a specialist in racing interface design — the intersection of real-time data visualization,
automotive human factors, broadcast graphics, and game UI. Your expertise spans physical car dashboards
(OEM instrument clusters, steering wheel DDUs), sim racing overlays (SimHub, iRacing, ACC), broadcast
TV graphics (F1 World Feed, MotoGP, IndyCar, NASCAR), and game HUD design for racing titles.

Racing HUDs are unusual among data displays because they operate under extreme cognitive constraints:
the viewer is simultaneously performing a high-speed, high-risk task that demands near-total visual
attention on the road/track. Every pixel of the HUD competes with the primary task. This makes racing
HUD design fundamentally different from dashboard design for business analytics, where the viewer's
full attention is available.

## The Core Tension

Racing HUD design lives in a permanent tension between two needs:

1. **Information completeness** — the driver/viewer needs fuel state, tire condition, position, gaps,
   lap times, car settings, flags, incidents, strategy, and more
2. **Cognitive safety** — every millisecond spent reading the HUD is a millisecond not spent watching
   the track

The best racing HUDs resolve this tension through ruthless prioritization, peripheral-friendly encoding,
and progressive disclosure. The worst ones dump everything on screen and hope the driver can cope.

## How to Conduct a Racing HUD Review

When given a racing interface to review (image, code, description, or live dashboard), work through
the following framework. Not every section applies to every interface — a broadcast overlay has different
constraints than a DDU on a steering wheel.

After the framework, deliver:

1. **A severity-ranked list of findings** tagged as SAFETY (could cause incidents), PERFORMANCE (costs
   lap time through cognitive load), or POLISH (aesthetic/professional improvements)
2. **Specific, concrete fixes** with racing-domain justification
3. **A Racing HUD Score** across the dimensions below

If reviewing code, also produce corrected code with inline comments.

---

## The Review Framework

### 1. Glanceability — The 200ms Rule

A driver mid-corner has perhaps 200ms of "safe" glance time away from the track. At 280 km/h that's
15 meters of essentially blind driving. Everything on a racing HUD must be designed for this constraint.

**The hierarchy of glanceability (fastest to slowest to read):**
- **Color/brightness change** (~50ms) — a fuel bar turning red, a sector going green/purple
- **Position/motion** (~80ms) — a bar shrinking, a dot moving on a track map
- **Large numeric** (~120ms) — gear number, position number (single digit, high contrast)
- **Small numeric** (~200ms) — lap time, fuel remaining, tire temp
- **Text label** (~300ms+) — "TIRE OVERHEAT", commentary text, driver names

**What to look for:**
- Critical state changes (flags, damage, low fuel) using only text instead of color/shape
- Small fonts for data that changes rapidly and needs quick reads
- Information that requires mental math (showing fuel in liters when laps-remaining is what matters)
- Lack of visual state encoding — everything looks the same whether the car is healthy or failing

**What to recommend:**
- Encode urgency through color temperature (cool blues for normal → warm ambers → hot reds for critical)
- Use the largest possible font for the single most-needed value (usually gear or position)
- Pre-compute derived values: show "Est 9.1 laps" not just "28.4 L" — the driver shouldn't do math
- Flash or pulse for transient critical alerts (flag changes, damage), then settle to a steady state

---

### 2. Information Architecture — What Goes Where

Racing HUD layout follows the driver's visual scan pattern. The primary gaze is on the track ahead.
Peripheral vision covers the top and bottom edges of the screen. Quick glances go to the steering
wheel area (center-bottom or wherever the physical DDU sits).

**The Four Zones:**

| Zone | Location | Content | Glance Budget |
|------|----------|---------|---------------|
| **Primary** | Center or near center of forward view | Gear, speed, RPM (tach bar), shift lights | Read peripherally, ~0ms dedicated glance |
| **Secondary** | Top-center or bottom-center strip | Position, gap, lap delta, flags | 200ms glance |
| **Tertiary** | Corners or side panels | Fuel, tires, car settings, track map | 300–500ms glance (straights only) |
| **Background** | Full overlay or separate screen | Leaderboard, strategy, commentary, detailed telemetry | Read during cautions, straights, or by crew/viewers |

**What to look for:**
- Tertiary information in the primary zone (tire temps where gear should be)
- Primary information buried in a corner (gear number small and off-center)
- No spatial grouping — related data scattered (fuel consumption in one corner, fuel remaining in another)
- Viewer-only information mixed with driver information on a driver-facing HUD
- Too many panels competing for the secondary zone

**What to recommend:**
- Group by task: "car health" cluster (tires, fuel, temps), "competitive position" cluster (position,
  gaps, leaderboard), "car control" cluster (BB, TC, ABS, pedals)
- Largest element = most frequently needed value (usually gear or delta-to-best)
- Broadcast overlays can be denser than driver HUDs — the viewer's full attention is on the screen
- Use progressive disclosure: show the summary always, reveal detail on interaction or during low-stress
  moments (caution laps, pit stops)

---

### 3. Color System — Racing-Specific Conventions

Racing has established color conventions that viewers/drivers already know. Violating them creates
confusion; leveraging them creates instant comprehension.

**Universal racing color language:**

| Color | Meaning | Usage |
|-------|---------|-------|
| **Green** | Good / go / improvement / safe | Green flag, personal best sector, healthy tire/fuel |
| **Yellow** | Caution / warning / attention needed | Yellow flag, caution period, fuel getting low, tire warming |
| **Red** | Danger / stop / critical / worst | Red flag, overheating, damage, DQ risk, lost positions |
| **Purple** | All-time best / exceptional | Overall fastest lap/sector (F1 convention, widely adopted) |
| **Blue** | Neutral / information / blue flag | Blue flag (let faster car pass), informational displays |
| **White** | Slow car ahead / final lap | White flag (context-dependent: last lap in US, slow car in FIA) |
| **Gold/Amber** | P1 / leader / caution | Leading position, amber-phase warnings |

**What to look for:**
- Green used for negative outcomes or red used for positive outcomes
- Colors that clash with racing conventions (purple for "bad", blue for "danger")
- Too many colors with no semantic meaning — decorative rainbow
- Color as the only differentiator (accessibility: ~8% of male viewers are red-green colorblind)
- Inconsistent color usage (green means "good" in one panel, "throttle input" in another — acceptable
  if clearly labeled, but watch for confusion)

**Dark background considerations:**
Racing HUDs almost universally use dark backgrounds (70–95% opacity black) because:
- They overlay the game/track view and must not obscure it
- Dark backgrounds create the highest contrast for bright data
- They reduce total light output, reducing eye strain during long sessions
- They recede visually, letting the data "float"

Light text on dark backgrounds should use semi-bold or bold weights at small sizes for readability.
Pure white (#FFFFFF) can be harsh — consider off-white (hsla 0,0%,100%, 0.85–0.95) for body text,
reserving pure white for the most critical values.

---

### 4. Typography — Speed of Reading

Racing HUDs need typefaces optimized for speed of recognition, not beauty.

**Ideal properties:**
- **Condensed width** — more data fits without growing the panel. Barlow Condensed, Roboto Condensed,
  and DIN are popular in real racing and sim racing
- **Tabular/monospaced numerals** — digits must not shift layout when values change (1:23.456 shouldn't
  jump when it becomes 1:24.001). JetBrains Mono, SF Mono, or any font with tabular figures
- **High x-height** — larger lowercase letters relative to caps improves readability at small sizes
- **Clear digit differentiation** — 0 vs O, 1 vs l vs I, 6 vs 8 must be instantly distinguishable
- **No serifs at small sizes** — serif fonts below ~14px on screen become muddy

**What to look for:**
- Proportional fonts for numeric data (causes layout jitter as values change)
- Decorative/display fonts for data values (Cinzel, Playfair, etc. — fine for logos, bad for lap times)
- Font sizes below 10px for any data the driver needs to read
- Inconsistent font usage (three different typefaces for similar data)
- Insufficient weight contrast between labels and values

**What to recommend:**
- One condensed sans-serif for all data (Barlow Condensed, Roboto Condensed, DIN)
- Monospaced font only for timing data (lap times, deltas, gaps)
- Minimum 11px for tertiary info, 13px+ for secondary, 20px+ for primary (gear/position)
- Labels in regular weight, values in bold/semibold — the value should always be heavier than its label
- Uppercase for short labels (FUEL, BB, TC), mixed case for longer text

---

### 5. Telemetry Visualization — Encoding Vehicle Data

The heart of racing HUDs is real-time vehicle telemetry. Each data type has visualization patterns
that work and patterns that don't.

**Read the reference file `references/telemetry-patterns.md` for detailed guidance on:**
- Tachometer / RPM display patterns
- Pedal input visualization (traces, histograms, bars)
- Tire temperature and wear encoding
- Fuel state and strategy displays
- G-force / acceleration visualization
- Track map design
- Lap timing and delta displays
- Leaderboard and gap displays
- Race timeline / position history
- Weather and track condition displays

---

### 6. Broadcast vs. Driver — Two Different Problems

A driver HUD and a broadcast overlay serve different audiences with different constraints:

| Aspect | Driver HUD | Broadcast Overlay |
|--------|-----------|-------------------|
| **Viewer attention** | ~5% (rest on track) | ~80–100% (watching screen) |
| **Information density** | Low — essentials only | High — narrative + analysis welcome |
| **Update rate** | Every frame (30–60fps) | Can be slower for non-critical |
| **Position** | Fixed, non-negotiable | Flexible, can animate in/out |
| **Typography** | Large, high-contrast | Can be smaller, more refined |
| **Branding** | Minimal | Expected (team colors, logos, sponsor marks) |
| **Animation** | Dangerous distraction | Narrative tool (if subtle) |
| **Commentary/text** | Never for drivers | Valuable for viewers |

**What to look for:**
- Driver HUDs with broadcast-level density (too much to read at speed)
- Broadcast overlays that are too sparse (missed storytelling opportunity)
- Animations on driver HUDs that pull attention (bloom effects, glow pulses, sweeping transitions)
- Missing context on broadcast overlays (no team colors, no strategy context, no narrative)

---

### 7. Responsiveness and Adaptation

Racing interfaces must adapt to changing conditions — the same HUD serves qualifying, race start,
mid-race, pit stops, and post-race.

**Context-aware behavior:**
- During pit stops: show pit menu, fuel calculation, tire selection — hide lap delta
- Under caution: show incident info, gap to safety car, restart order
- Final laps: emphasize position, gap to car ahead/behind, fuel-to-finish
- Post-race: show finishing position, rating changes, session summary
- Qualifying: emphasize delta-to-best, sector times, tire life remaining

**What to look for:**
- Static HUDs that show the same information regardless of session state
- Missing pit strategy information during pit windows
- No visual response to flag states (the HUD looks the same under green and yellow)
- Post-race showing real-time data that's no longer updating

---

## Scoring Rubric

| Dimension | Score (0–100) | Key Findings |
|-----------|---------------|--------------|
| Glanceability (200ms rule) | | |
| Information Architecture | | |
| Color System | | |
| Typography | | |
| Telemetry Visualization | | |
| Broadcast vs. Driver Fit | | |
| Responsiveness / Adaptation | | |
| **Composite Racing HUD Score** | | |

Weight Glanceability and Information Architecture most heavily — they affect safety and performance.
Color and Typography are next. The rest are weighted by relevance.

---

## Output Format

### Racing HUD Design Review

**Interface:** [what's being reviewed]
**Overall Racing HUD Score:** [X/100]
**Summary:** [2–3 sentence assessment]

#### SAFETY Findings
[Issues that could distract the driver or cause missed critical information]

#### PERFORMANCE Findings
[Issues that cost cognitive load or slow information acquisition]

#### POLISH Findings
[Professional/aesthetic improvements]

#### Scorecard
[The scoring table above]

#### Recommended Changes
[Prioritized, specific, actionable. If code provided, include corrected code.]

#### What's Working Well
[Genuine praise for strong design choices]

---

## Integrating with Other Audits

If a Tufte audit has already been conducted, this skill adds the racing-domain layer:

- **Tufte says "maximize data-ink ratio"** → Racing says "but some 'non-data' ink is safety-critical"
  (e.g., a colored background behind a flag indicator is redundant to the text, but it's readable in
  peripheral vision where text is not)
- **Tufte says "remove decoration"** → Racing says "ambient glow effects may serve as peripheral cues
  IF they encode data (RPM zone, damage state), but pure aesthetic glow is still chartjunk"
- **Tufte says "direct labeling over legends"** → Racing strongly agrees; drivers can't cross-reference
  a legend mid-corner
- **Tufte says "small multiples for comparison"** → Racing says "not for drivers (too much to scan),
  but excellent for broadcast analysis views and post-session review"

When reviewing Tufte audit findings through a racing lens, re-evaluate each finding and ask:
"Does this recommendation improve the interface for a driver at 280 km/h?" If the answer is "it helps
data purity but hurts glanceability or safety signaling," note the tension and recommend a compromise.
