# Commentary Engine

The commentary engine is the core decision-making system. It evaluates telemetry against trigger conditions, decides what to say and when, assembles prompt text from composable fragments, and resolves colors for dashboard display. Everything happens synchronously on SimHub's data update thread.

## Evaluation Pipeline

Every ~100ms (every 6th frame), `CommentaryEngine.Update()` runs the full pipeline:

1. **Check for expired prompts.** If the current prompt has been visible longer than `PromptDisplaySeconds`, clear it.

2. **Sort topics by severity.** Topics are ordered highest-severity-first, with random shuffling within each severity tier. This means a severity-5 event (wall contact, black flag) is always evaluated before a severity-1 event (ABS activation), but two severity-3 events get a fair chance at firing.

3. **For each topic, in priority order:**
   - Skip if the category is disabled in settings
   - Skip if the topic's `sessionTypes` filter doesn't match the current session (empty = all sessions)
   - Skip if the topic is in cooldown (per-topic timer, adjusted by feedback multiplier)
   - Evaluate all triggers against the current and previous telemetry snapshots
   - If a trigger fires: check severity-based interruption rules, then show the prompt

4. **Fire at most one prompt per evaluation cycle.** The first topic that passes all checks wins.

## Severity-Based Interruption

The severity system (1-5) controls whether a new event can replace one that's already on screen:

- A new event can only **replace** an active prompt if it has **strictly higher** severity.
- Equal-severity events do not interrupt each other. The one that's already showing keeps its display time.
- Severity 5 events (wall contact, spin catch, black flag) can always interrupt anything.

There's also a global anti-spam cooldown of 8 seconds between non-critical events when nothing is currently visible. This prevents rapid-fire low-severity prompts during chaotic track situations.

## Trigger System

`TriggerEvaluator` is a pure-logic class with no SimHub dependencies. It implements 18 condition types:

### Value Comparisons
- `>`, `<`, `==` — Compare a telemetry field against a threshold value.

### Delta Conditions
- `change` — Absolute difference between current and previous frame exceeds `thresholdDelta`.
- `increase` — Value increased since the previous frame.
- `spike` — Delta exceeds `thresholdDelta` in a single evaluation window. Used for kerb hits (VertAccel), FFB spikes (SteeringWheelTorque).
- `sudden_drop` — Delta is less than negative `thresholdDelta`.

### Extreme Values
- `extreme` — Absolute value exceeds `absValue`. Used for yaw rate (spin detection).
- `rapid_change` — More than 2 units of change in a single frame. Currently used for gear changes.

### Derived Conditions
- `personal_best` — Current lap time is the fastest of the session.
- `player_gain_position` — Race position decreased (moved up).
- `player_lost_position` — Race position increased (dropped back).
- `player_entering` — Player just entered pit lane.
- `off_track` — VertAccel spike exceeding 12G (indicates leaving the racing surface).
- `yellow_flag` — Session flags bitmask includes the yellow flag bit.
- `black_flag` — Session flags bitmask includes the black flag bit.
- `race_start` — Transition from lap 0 to lap 1 in a race session.
- `close_proximity` — Nearest opponent is within `proximityThreshold` track distance (default 0.8%).

### Data Points

Triggers reference fields on `TelemetrySnapshot` by name. The evaluator resolves the field via a lookup dictionary that maps string names to getter functions. This lets the JSON dataset reference any telemetry field without code changes.

iRacing-specific fields (SteeringWheelTorque, SessionFlags, DrsStatus, CarIdxLapDistPct) are populated only when iRacing is the active sim. Other sims get cross-game normalized fields (LatAccel, LongAccel, Speed, Fuel, etc.) through SimHub's abstraction layer.

## Prompt Assembly

When a topic fires, `CommentaryEngine.ShowPrompt()` builds the display text:

1. **Try FragmentAssembler first.** If the topic has entries in `commentary_fragments.json`, assemble a sentence from randomly selected opener + body + closer.

2. **Fall back to static prompts.** If no fragments exist for this topic, pick a random entry from the topic's `commentaryPrompts` array.

3. **Substitute placeholders.** Replace `{ahead}` with the nearest opponent ahead (name + iRating), `{behind}` with the nearest opponent behind, `{value}` with the trigger's current telemetry value (formatted with appropriate units).

4. **Build exposition text.** Interpolate the trigger value into the topic's `eventExposition` template for event-only mode display.

### Fragment Assembly

`FragmentAssembler` loads `commentary_fragments.json` at startup and builds a lookup by topic ID. Each topic has three arrays: openers, bodies, and closers.

Assembly is straightforward: pick one from each, join with spaces. But to avoid repetition, each slot maintains a ring buffer of the 3 most recently used fragments. `SelectFragment()` filters out recent entries before making a random selection. When all fragments for a slot are in the recent buffer, it resets the history.

This gives each topic N x M x K unique combinations. With a minimum of 6 openers, 8 bodies, and 5 closers, that's 240+ unique sentences per topic — a significant improvement over the 4-5 static prompts in the fallback pool.

Empty closers are allowed (at most one per topic). An empty closer means the sentence ends after the body, which gives natural variation in sentence length.

## Color System

Colors serve two purposes: dashboard styling and Homebridge light control. The system avoids flag color collisions by deriving prompt colors from the topic category rather than sentiment.

### Category to RGB

Each category maps to a base hue that doesn't conflict with any race flag color:

| Category | Hue | Hex | Rationale |
|----------|-----|-----|-----------|
| hardware | Cyan | #00ACC1 | Cool technical tone |
| game_feel | Purple | #AB47BC | Subjective/perceptual |
| car_response | Green | #66BB6A | Mechanical/physical |
| racing_experience | Magenta | #EC407A | High-energy competitive |

### Severity to Alpha

The severity level (1-5) determines the opacity of the category color:

| Severity | Alpha | Opacity | Visual Effect |
|----------|-------|---------|---------------|
| 1 (Info) | 0x66 | 40% | Barely visible, background-level |
| 2 (Notable) | 0x8C | 55% | Present but not demanding |
| 3 (Significant) | 0xB3 | 70% | Clearly visible |
| 4 (Urgent) | 0xD9 | 85% | Strong presence |
| 5 (Critical) | 0xFF | 100% | Full intensity, impossible to miss |

### Output Format

Colors are output in `#AARRGGBB` format (SimHub's expected format). `NormalizeColor()` handles conversion from any input format:
- `#RGB` → `#FFRRGGBB`
- `#RRGGBB` → `#FFRRGGBB`
- `#AARRGGBB` → passed through

A bright text color is generated from the same hue for WCAG AA contrast.

## Cooldowns

Each topic has a `cooldownMinutes` value (stored in seconds internally despite the name — it's minutes in the JSON). After a topic fires, it can't fire again until the cooldown expires.

The `FeedbackEngine` modifies cooldowns with a per-topic multiplier. If a user rates a prompt positively, the multiplier decreases (fires slightly more often). Negative ratings increase the multiplier (fires less often). This is a soft learning system — it adjusts frequency without changing the trigger conditions.

## Demo Mode

When `DemoMode` is enabled, the engine ignores live telemetry and instead fires a curated sequence from `DemoSequence.cs`. The sequence demonstrates the severity interruption system: it fires events of increasing severity, shows how higher-severity events replace lower ones, and cycles through all four categories.

This is useful for testing the dashboard layout, verifying colors render correctly, and demonstrating the plugin's behavior without needing a live sim session.
