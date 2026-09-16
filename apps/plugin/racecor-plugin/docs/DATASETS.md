# Dataset Documentation

All data files live in `racecorprodrive-data/` and are copied to the SimHub installation directory at build time. The plugin loads them at startup. The fragment generation tooling and source index also live here.

## Files

| File | Purpose | Version |
|------|---------|---------|
| `commentary_topics.json` | Topic definitions, triggers, thresholds, prompts | 5.0 |
| `commentary_fragments.json` | Composable sentence fragments per topic | 2.0 |
| `sentiments.json` | Sentiment vocabulary, phrase patterns, colors | 2.0 |
| `channel_notes.json` | YouTube channel style profiles for voice matching | 1.0 |
| `commentary_sources.json` | Index of alternative transcript sources | 1.0 |
| `scripts/fetch_transcripts.py` | Transcript fetching utility | — |

## commentary_topics.json

This is the core dataset. Each topic defines what triggers it, how severe it is, what category it belongs to, and what text to display.

### Topic Schema

```json
{
  "id": "spin_catch",
  "category": "car_response",
  "title": "Big Save",
  "sentiment": "technical_analytical",
  "severity": 5,
  "eventExposition": "Snap oversteer — yaw rate hit {value} rad/s, full correction needed",
  "sessionTypes": [],
  "description": "Extreme yaw event — genuine snap oversteer or spin attempt.",
  "triggers": [
    {
      "dataPoint": "YawRate",
      "condition": "extreme",
      "absValue": 3.0,
      "context": "True snap oversteer — yaw rate well beyond normal cornering"
    }
  ],
  "commentaryPrompts": ["..."],
  "cooldownMinutes": 4
}
```

### Fields

**`id`** — Unique identifier. Must match the `topicId` in `commentary_fragments.json` if fragments exist for this topic.

**`category`** — One of: `hardware`, `game_feel`, `car_response`, `racing_experience`. Determines the base color hue in the dashboard.

**`title`** — Human-readable event name shown in the dashboard when `ShowTopicTitle` is enabled.

**`sentiment`** — Cross-reference to `sentiments.json`. The sentiment's label is appended to the category display (e.g., "Car Response — Technical"). Optional; topics without a sentiment just show the category.

**`severity`** — Integer 1-5. Controls interruption priority (higher can replace lower), color opacity, and Homebridge light brightness.

| Level | Label | Meaning |
|-------|-------|---------|
| 1 | Info | Background observation, no urgency |
| 2 | Notable | Worth mentioning, doesn't demand attention |
| 3 | Significant | Something happened that matters |
| 4 | Urgent | Race-changing event, demands immediate attention |
| 5 | Critical | Catastrophic event (crash, spin, disqualification) |

**`eventExposition`** — Template string for event-only mode. Placeholders: `{value}` (trigger's current telemetry reading), `{ahead}` (nearest driver ahead), `{behind}` (nearest driver behind).

**`sessionTypes`** — Optional array of session type strings (`"race"`, `"qual"`, `"practice"`). Empty array means the topic fires in all session types.

**`triggers`** — Array of trigger conditions. Any single trigger firing is enough to activate the topic.

**`commentaryPrompts`** — Fallback prompt pool. Used when no fragments exist for this topic. The FragmentAssembler takes priority when fragments are available.

**`cooldownMinutes`** — Minimum time between consecutive fires of this topic (in minutes in the JSON, converted to seconds internally).

### Trigger Conditions

Each trigger specifies a `dataPoint` (telemetry field name), a `condition` (evaluation type), and condition-specific parameters.

| Condition | Parameters | Description |
|-----------|-----------|-------------|
| `>` | `value` | Field > threshold |
| `<` | `value` | Field < threshold |
| `==` | `value` | Field equals value |
| `change` | `thresholdDelta` | Absolute delta exceeds threshold |
| `increase` | — | Value increased since last frame |
| `spike` | `thresholdDelta` | Single-frame delta exceeds threshold |
| `sudden_drop` | `thresholdDelta` | Single-frame delta below negative threshold |
| `extreme` | `absValue` | Absolute value exceeds threshold |
| `rapid_change` | — | More than 2 units change in one frame |
| `personal_best` | — | New fastest lap this session |
| `player_gain_position` | — | Race position improved |
| `player_lost_position` | — | Race position dropped |
| `player_entering` | — | Entered pit lane |
| `off_track` | — | VertAccel spike > 12G |
| `yellow_flag` | — | Yellow flag bitmask active |
| `black_flag` | — | Black flag bitmask active |
| `race_start` | — | Lap transitioned from 0 to 1 |
| `close_proximity` | `proximityThreshold` | Nearest car within threshold distance |

### Current Topics (v5.0)

33 topics across 4 categories:

**car_response (12):** spin_catch, kerb_hit, abs_activation, tc_intervention, high_cornering_load, tyre_wear_high, hot_tyres, heavy_braking, ers_low, drs_active, car_balance_sustained, rapid_gear_change

**racing_experience (18):** wall_contact, off_track, close_battle, position_gained, position_lost, yellow_flag, debris_on_track, race_start, formation_lap, personal_best, pit_entry, low_fuel, wet_track, qualifying_push, incident_spike, black_flag, long_stint, session_time_low

**game_feel (2):** track_temp_hot, track_temp_cold

**hardware (1):** ffb_torque_spike

### Threshold History

Several thresholds were corrected based on real-world testing. The test suite includes regression tests to prevent these from drifting back:

| Topic | Field | Original | Corrected | Reason |
|-------|-------|----------|-----------|--------|
| tyre_wear_high | TyreWearFL/FR/RL | > 0.65 | < 0.35 | iRacing reports remaining life (1.0=new), not wear |
| hot_tyres | TyreTempFL/FR | 115 | 250 | Temps are in Fahrenheit, not Celsius |
| kerb_hit | VertAccel spike | 7.0 | 10.0 | Normal bumps triggered at 7G |
| ffb_torque_spike | SteeringWheelTorque | 18.0 | 25.0 | Normal cornering forces triggered at 18Nm |
| spin_catch | YawRate extreme | 2.5 | 3.0 | Fast chicanes hit 2.5 normally |
| close_battle | proximity | 0.01 | 0.008 | 1% track distance too generous |
| heavy_braking | LongAccel | -32.0 | -38.0 | -32 m/s² (~3.3G) is routine |
| high_cornering_load | LatAccel | 4.0 | 4.5 | 4.0G is common |
| car_balance_sustained | LatAccel | 3.5 → 4.0 → 4.2 | 4.2 | Refined across testing rounds |
| qualifying_push | LapDeltaToBest | -0.4 → -0.6 → -0.8 | -0.8 | -0.4s is normal variance |

## commentary_fragments.json

Pre-generated sentence fragments for composable assembly at runtime. Each topic gets three arrays: openers, bodies, and closers. The engine picks one from each and joins them into a complete sentence.

### Fragment Schema

```json
{
  "topicId": "position_lost",
  "fragments": {
    "openers": [
      "Lost that one.",
      "They got through.",
      ...
    ],
    "bodies": [
      "{behind} found the gap and took it — {rating_context}.",
      "Got outbraked into the corner by {behind}.",
      ...
    ],
    "closers": [
      "Need to respond, not react.",
      "Chase it down.",
      ""
    ]
  }
}
```

**Minimum counts:** 6 openers, 8 bodies, 5 closers per topic (240+ unique combinations).

**Empty closers:** At most one empty string per topic's closers array. This produces sentences that end naturally after the body, adding variation to sentence length.

**Placeholders:** `{ahead}`, `{behind}`, `{value}`, `{rating_context}`, `{corner_name}`. Substituted at runtime by `FragmentAssembler` using live telemetry data.

**Generation:** Fragments are generated offline by `tools/generate_fragments.py`, which calls Claude Haiku with the full `commentary_topics.json`, `sentiments.json`, and `channel_notes.json` as context. The output is deterministic text — no API calls happen at runtime.

## sentiments.json

Sentiment definitions with phrase vocabulary and colors. Topics reference sentiments by ID; the sentiment label is displayed alongside the category name in the dashboard.

### Sentiment Schema

```json
{
  "id": "technical_analytical",
  "label": "Technical / Analytical",
  "color": "#00ACC1",
  "description": "Calm, thoughtful analysis of car behavior, setup, or driving technique.",
  "phrases": ["..."]
}
```

**Colors** are in `#RRGGBB` format. The plugin converts to `#AARRGGBB` at runtime via `NormalizeColor()`. Sentiment colors intentionally avoid red, yellow, blue, and orange to prevent confusion with race flags. The test suite validates this — any new sentiment color that falls within 15 degrees of a flag hue will fail validation.

**Phrases** are style reference material. They're not directly used by the runtime plugin (the fragments and static prompts are the actual output text), but they serve as vocabulary and tone guides for fragment generation and future AI-driven commentary.

### Current Sentiments (v2.0)

| ID | Label | Color | Used By Topics |
|----|-------|-------|----------------|
| excitement_positive | Excitement / Positive | #66BB6A | close_battle, position_gained, race_start, heavy_braking, qualifying_push, drs_active, personal_best |
| frustration_negative | Frustration / Negative | #EC407A | wall_contact, position_lost, incident_spike, black_flag |
| technical_analytical | Technical / Analytical | #00ACC1 | spin_catch, kerb_hit, abs_activation, tc_intervention, ffb_torque_spike, tyre_wear_high, hot_tyres, ers_low, rapid_gear_change |
| self_deprecating | Self-Deprecating Humor | #CE93D8 | off_track |
| car_praise | Car Praise | #81C784 | high_cornering_load, car_balance_sustained |
| neutral_narrative | Neutral Narrative | #37474F | yellow_flag, debris_on_track, low_fuel, wet_track, pit_entry, formation_lap, long_stint, session_time_low, track_temp_hot, track_temp_cold |
| sim_comparison | Sim Comparison | #4DD0E1 | (unused — available for future topics) |
| driving_advice | Driving Advice | #AB47BC | (unused — available for future topics) |
| spotter_alert | Spotter / Proximity | #78909C | (unused — available for future topics) |
| race_engineer | Race Engineer / Strategy | #546E7A | (unused — available for future topics) |

## channel_notes.json

Style profiles for YouTube channels used as voice-matching references. Each channel entry documents the creator's speech patterns, topic emphasis, and sentiment tendencies.

This file is used by the fragment generation tool (`tools/generate_fragments.py`) to match Kevin's voice when generating new fragments. It's also the intended style input for Version 2.0's live AI commentary system prompt.

### Current Channels

13 channels indexed across three tiers:

**Original 8** (sim racing creators): jimmy_broadbent, mgcharoudin, jaaames, traxion_gg, justhun_gaming, project_sim_racing, just_sim_racing, redd500_gaming

**Added in v2.0** (broadcast and coaching): global_simracing_channel, racespot_tv, apex_racing_tv, driver61, suellio_almeida

## commentary_sources.json

A comprehensive index of alternative transcript sources for enriching the fragment vocabulary. Organized by source type:

- **sim_racing_broadcast** — Professional broadcast teams (GSRC, RaceSpot TV, Apex Racing TV)
- **real_motorsport_broadcast** — Real-world racing commentary (Radio Le Mans, Sky F1, MRN/PRN)
- **f1_team_radio** — Team radio transcripts (RaceFans, F1 Radio Replay)
- **coaching_and_instructional** — Technique-focused content (Driver61, Suellio Almeida)
- **structured_phrase_databases** — Machine-readable phrase pools (Crew Chief V4, Digital Race Engineer)
- **podcasts_and_editorial** — Long-form analysis (Talking Tenths, The Late Apex, Marshall Pruett)
- **user_content** — Kevin's own channel and website (alternate.org)

Each source entry includes relevance scores per category, acquisition method, and an assessment of its unique value to the fragment pool.

## Adding a New Topic

1. Add the topic definition to `commentary_topics.json` with a unique `id`, valid `category`, triggers, severity, and at least 4 commentary prompts.

2. Add a matching entry in `commentary_fragments.json` with the same `topicId` and at least 6 openers, 8 bodies, and 5 closers.

3. If the topic uses a new sentiment, add it to `sentiments.json` with a color that doesn't collide with flag hues.

4. Run the validation suite: `python3 tests/validate_datasets.py`. All 28 tests must pass.

5. Rebuild the SimHub plugin to copy the updated dataset to the SimHub directory.
