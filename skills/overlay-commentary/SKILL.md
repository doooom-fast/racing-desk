---
name: overlay-commentary
description: |
  Overlay commentary and coaching system expert for the Electron HUD.
  Use when working on the AI commentary engine, race coach (Claude integration),
  incident coach, voice coach TTS, commentary panel animation, threat detection,
  composure tracking, or any real-time AI-driven coaching/commentary features.
  Triggers: commentary, race coach, incident coach, voice coach, TTS, speech synthesis,
  AI analysis, post-race debrief, threat detection, composure, rage score, coaching,
  commentary panel, commentary viz, broadcast commentary, tone, depth.
---

# Overlay Commentary & Coaching System Expert

You are an expert on the AI commentary, coaching, and real-time analysis systems in the RaceCor overlay. These systems provide live race commentary, post-race AI analysis, incident coaching, and voice feedback during racing.

## Files to Read on Activation

```
# Commentary engine (plugin side — triggers & fragments)
racecor-plugin/docs/COMMENTARY_ENGINE.md               # Trigger system architecture
racecor-plugin/simhub-plugin/racecorprodrive-data/commentary_topics.json     # Trigger definitions
racecor-plugin/simhub-plugin/racecorprodrive-data/commentary_fragments.json  # Sentence fragments
racecor-plugin/simhub-plugin/racecorprodrive-data/sentiments.json            # Sentiment colors

# AI Race Coach (Claude API integration)
racecor-overlay/modules/js/race-coach.js               # Post-race Anthropic API calls (16KB)

# Incident Coach (real-time threat detection + coaching)
racecor-overlay/modules/js/incident-coach.js           # Threat parsing, composure, vignette (26KB)
racecor-overlay/modules/js/voice-coach.js              # TTS engine, priority queue (8KB)
docs/FEATURE_SPEC_INCIDENT_COACH.md                    # Full incident coach spec
docs/AI_STRATEGIST_DESIGN.md                           # AI strategy system design

# Commentary visualization
racecor-overlay/modules/js/commentary-viz.js           # Telemetry charts for commentary events (35KB)

# Commentary UI
racecor-overlay/modules/styles/effects.css             # Commentary panel animation CSS

# Data flow
racecor-overlay/modules/js/poll-engine.js              # Commentary data routing from API
racecor-overlay/modules/js/config.js                   # Commentary property keys
```

## System Architecture

### Three Commentary Layers

The overlay has three distinct AI/coaching systems that operate independently:

```
Layer 1: COMMENTARY ENGINE (Plugin → Overlay)
  Plugin evaluates 33+ triggers → assembles fragments → serves via HTTP API
  Overlay displays commentary panel with slide-in animation
  Real-time, during racing, purely reactive to telemetry state

Layer 2: AI RACE COACH (Post-Race, Claude API)
  After race ends → collect session data → send to Anthropic API
  User selects tone (broadcast/coach/mentor) and depth (quick/standard/deep)
  Returns structured analysis with sections

Layer 3: INCIDENT COACH (Real-Time, Local Processing)
  Parses threat data from plugin API
  Tracks composure (rage score), detects patterns
  Triggers voice coaching via Web Speech API
  Shows cool-down vignette, composure indicator
```

### Layer 1: Commentary Engine

**Producer**: C# plugin (`racecor-plugin/simhub-plugin/`)
**Consumer**: Overlay poll-engine routes commentary properties to the UI

**Trigger System**:
- 33+ trigger conditions evaluated each telemetry frame
- Each trigger has: conditions (telemetry thresholds), severity (1-5), cooldown (minutes)
- When triggered: assembles a sentence from fragments (opener + body + closer)
- Fragments are pre-written in dataset JSON, randomized to avoid repetition (ring buffer)

**Commentary Properties** (from HTTP API):
```
RaceCorProDrive.Plugin.Commentary.Active     → bool
RaceCorProDrive.Plugin.Commentary.TopicId    → string (e.g., "heavy_braking")
RaceCorProDrive.Plugin.Commentary.Text       → assembled sentence
RaceCorProDrive.Plugin.Commentary.Category   → trigger category
RaceCorProDrive.Plugin.Commentary.Severity   → 1-5
RaceCorProDrive.Plugin.Commentary.Sentiment  → sentiment ID → color mapping
```

**UI**: Commentary panel slides in from the edge, shows topic title + text + category label. Border and background tint match the sentiment color (orange=warning, red=critical, blue=info, amber=strategy). Auto-dismisses when the event expires.

**Commentary Viz**: When active, `commentary-viz.js` renders a context-appropriate telemetry chart alongside the commentary text (gauge, line chart, g-force plot, etc. — mapped by topic ID).

### Layer 2: AI Race Coach

**Engine**: `race-coach.js`
**API**: Anthropic Claude (direct HTTP call from overlay)

**Tones** (user-selectable):

| Tone | Persona | Style |
|------|---------|-------|
| `broadcast` | Martin Brundle / David Croft | Dramatic, vivid, narrative-building, makes the race feel worth watching |
| `coach` | Racing engineer | Direct, analytical, data-driven, treats driver as peer, actionable feedback |
| `mentor` | Experienced sim racer | Encouraging, explains the "why", positive framing, celebrates before critiquing |

**Depth Profiles**:

| Depth | Model | Max Tokens | Cost | Output |
|-------|-------|------------|------|--------|
| `quick` | claude-haiku-4-5 | 350 | ~$0.01 | 2-sentence summary + 1-2 takeaways |
| `standard` | claude-sonnet-4-6 | 800 | ~$0.05 | Structured sections, 2-4 sentences each |
| `deep` | claude-sonnet-4-6 | 1500 | ~$0.15 | Lap-by-lap trends, corner-level advice, strategy for next race |

**Data sent to Claude**: Structured race summary including lap times, positions, incidents, fuel usage, tire degradation, overtakes, and key moments. Built from the session data captured by `session-sync.js`.

### Layer 3: Incident Coach

**Engine**: `incident-coach.js` + `voice-coach.js`
**Spec**: `docs/FEATURE_SPEC_INCIDENT_COACH.md`

**Threat Detection**:
- Parses `DriverThreatEntry[]` from plugin API
- Threat levels: NONE (0), WATCH (1), CAUTION (2), DANGER (3)
- Highlights threats on leaderboard and track map
- CSS classes: `ic-watch`, `ic-caution`, `ic-danger`

**Composure Tracking**:
- Rage score (0-100) — escalates on incidents, de-escalates over clean laps
- Composure indicator UI element (shows when rage score > threshold)
- Cool-down vignette (screen edge effect when composure drops)
- Tracks `cleanLapCounter`, `lastIncidentLap` for pattern detection

**Voice Coach** (Web Speech API TTS):
- Priority queue system (higher priority interrupts lower)
- Calm delivery: rate=0.9, pitch=0.85, volume=0.7
- Min gap between utterances: 3000ms
- Message pools randomized per situation:
  - `watch_info` (P1) — "Flagged driver nearby"
  - `caution_approaching` (P2) — "Caution. Flagged driver {gap}s {direction}"
  - `danger_close` (P3) — "Stay smooth. {name} is right {direction}"
  - `cool_down` — De-escalation prompts when rage score spikes

**CRITICAL PRINCIPLE**: Never reinforce hostile attribution bias. Voice prompts never imply intent from other drivers. Always de-escalate the narrative. Based on Kerwin & Bushman (2022) research.

## Sentiment Color System

Commentary sentiments map to colors that must not collide with race flag hues:

| Flag | Hue | Buffer Zone |
|------|-----|-------------|
| Red flag | H0 | ±15° |
| Orange flag | H30 | ±15° |
| Yellow/caution | H60 | ±15° |
| Green flag | H120 | ±15° |
| Blue flag | H240 | ±15° |

Sentiment colors are defined in `sentiments.json` and validated by the Python dataset tests (28 tests ensure no hue collision).

## Rules

1. **Three layers are independent** — Commentary engine, race coach, and incident coach operate on separate data paths and UI elements. Don't merge them.
2. **Commentary is plugin-driven** — The overlay doesn't evaluate triggers. It just renders what the plugin sends. Trigger logic changes go in `racecor-plugin/`.
3. **Race coach requires API key** — The Claude API call is made directly from the overlay. `ANTHROPIC_API_KEY` must be configured.
4. **No hostile attribution in voice** — Voice prompts MUST NOT imply intent from other drivers ("he hit you", "that was dirty"). Always use neutral language ("contact occurred", "incident at T4").
5. **Sentiment colors are validated** — Adding a new sentiment requires passing the 15° flag hue collision test. Run `python3 tests/validate_datasets.py`.
6. **Fragment minimums** — New commentary topics need ≥6 openers, ≥8 bodies, ≥5 closers to avoid repetition.
7. **Cooldowns prevent spam** — Each topic has a cooldown in minutes. Commentary won't re-fire until the cooldown expires.
8. **Voice coach is additive** — TTS is a supplement to visual coaching, not a replacement. All voice events must also have a visual indicator.
9. **De-escalation over information** — When the driver is upset (high rage score), prioritize calming messages over tactical information.
