# RaceCorProDrive Plugin Feedback

This document contains my observations from an hour of testing the plugin and dashboard last night. read them all, formulate a plan for how to do this work with the "next steps" in mind as a future version (without actually performing that work right now). execute that plan, possibly re-evaluating the original data sources for more granular information.

## Prompt Diversity

### Problem

i pretty much only got two prompts: one asking about the car fighting me or balanced, and the other asking me what the car needs to be fast. i got one more at the beginning of the sessions sometimes about fuel and how many laps. We need to diversify the prompts i receive, and possibly tune the events to get more timely information.

### Solution

1. investigate the prompt events, and figure out why i was only receiving car balance prompts.
2. figure out how to diversify these prompts such that an interesting prompting session occurs that is moderately different from the last one. my experiences were all almost identical here
3. update the prompt eventing system such that it fires when something happens on track, not only on the scheduled interval

## Prompt TIming

### Problem

i was expecting more in-depth suggestions about events as they happen on-track, but the prompts seemed to take a long time to show up, and stuck around for much longer than i expected. also, the countdown timer just didn't work at all; it was spamming the text field with numbers, or just not displaying anything. above and beyond the observation that the settings panel didn't seem to affect the plugin's behavior at all, which we need to fix for how long the prompts stay on screen.

### Solution

1. remove the setting for prompt timing, since we are alerting when things happen now, not on a schedule
2. give more granular choices for the dismissal setting, in 5 second increments
3. figure out why these settings didn't apply when in use, and why the prompts stayed around so long, and took so long to show up. fix these issues.

## Prompt sentiment

### Problem

while we added sentiment and background colors to the dataset, it doesn't affect the prompts in any way. we need to fine-tune the event timing, and attach sentiment and suggested statements to make, not simply questions about what to talk about. i was hoping for more of an opinionated system.

### Solution

this is the biggest lift of the update. we need a much more interesting and opinionated set of prompts than what i'm currently receiving.

1. investigate the updated list of diversified prompts, and break them up into sentiments related to the sentiments we added color coding for
2. change the suggestions made by the plugin from generic questions into sentiment-based statements, using the real-time data stream to identify and respond to trends on-track. pay incredibly close attention to: loss of grip, loss of control, crashing into objects, crashing into other drivers, going off-track, having car issues due to an accident, track conditions (rain, temperatures, time of year, time of day)
3. fine-tune the suggestions based on session type: time trial, test drive, official practice, qualifying, gridded up in race, formation lap in race, slow laps in race, hard/push laps in race, entering pits, etc.

## Next Steps: Testing

1. build a testing system such that we can take recorded race data, and generate transcripts of when a message would occur during a data stream
2. build a learning system such that we can take feedback to these testing results to fine-tune the eventing system, sentiments, and prompt text

---

## Version 2.0: AI-Generated Commentary via Claude API

Instead of selecting from a pre-written pool of commentary prompts, version 2.0 would call the Claude API (claude-haiku-4-5 for latency reasons) at the moment a telemetry event fires, generating a unique, contextually-aware line of commentary every time. The static `commentaryPrompts` arrays in the topics JSON become system prompt templates and style guides rather than the final text. This is the path toward genuinely non-repetitive, voice-matched, situation-aware commentary.

### Architecture

**New class: `CommentaryGenerator`**

A thin async wrapper around the Anthropic Messages API. Lives in `Engine/CommentaryGenerator.cs`. Responsible for:

1. Building a prompt from the current `TelemetrySnapshot` + the fired `CommentaryTopic`
2. Making a non-blocking HTTP POST to `https://api.anthropic.com/v1/messages`
3. Calling back into `CommentaryEngine` with the generated text when the response arrives

The key design constraint is that this must be **fire-and-forget with a callback** — never block the SimHub data loop. The engine fires the API call, immediately shows a brief loading state or the event exposition text (already built), then replaces it with the generated line when it arrives (~200-400ms for Haiku).

**New setting: `AnthropicApiKey`**

Added to `Settings.cs` and surfaced as a password-style text field in `Control.xaml`. The key is stored via SimHub's existing settings serialization (`SaveCommonSettings`) — not to disk in plaintext separately.

**System prompt construction**

The system prompt sent to the API would be assembled from three layers:

1. **Voice/style layer** — drawn from `channel_notes.json`, specifically Kevin's profile. Instructs the model to write in first person, present tense, technically grounded, direct, no filler phrases. The full style notes from `channel_notes.json` for the active channel feed directly into this.

2. **Event layer** — the fired topic's `title`, `sentiment`, `severity`, and `eventExposition` (already interpolated with live telemetry values). Tells the model what just happened and how urgent it is.

3. **Context layer** — a compact telemetry summary: session type, lap number, position, nearest opponents (names + iRatings), tyre state, fuel, weather, and the circuit position if available. Keeps the model grounded in the actual race situation.

Example assembled system prompt for a `position_lost` (severity 4) event:
```
You are Kevin, a technically-minded sim racing streamer. Write a single spoken commentary line
in first person, present tense. Be direct and specific. No filler phrases. Max 25 words.

EVENT: Position Lost [URGENT] — Overtaken by Sarah K. (2847 iR), dropped to P6
SESSION: Race, lap 14/20, Lime Rock Park
CONTEXT: P6 of 18, fuel 34%, fronts warm, gap to P7 is 1.2s
```

The model returns one line. That line replaces the prompt text in `_currentText`.

**Latency handling**

Because even Haiku takes 200-500ms, the display sequence is:

1. Event fires → `CurrentEventExposition` shown immediately (the interpolated short text, already built synchronously)
2. API call dispatched on a `Task.Run` thread
3. On API response: if the prompt is still visible (hasn't been interrupted by a higher-severity event), replace the text with the generated line

This means the exposition acts as a loading placeholder. In event-only mode, nothing changes — the exposition is the final output and no API call is made.

**Fallback**

If the API key is empty, the network is unavailable, or the call exceeds a 1.5s timeout, the engine falls back to the existing static prompt pool exactly as today. No degradation in the no-API path.

### New Settings

| Setting | Type | Default | Notes |
|---|---|---|---|
| `AnthropicApiKey` | string | "" | Stored via SimHub settings serialization |
| `AiCommentaryEnabled` | bool | false | Master toggle, requires key to activate |
| `AiMaxWords` | int | 25 | Caps generated line length |
| `AiFallbackOnTimeout` | bool | true | Use static pool if API exceeds 1.5s |

### What Doesn't Change

- The trigger system, severity system, interruption logic, and cooldowns are all unchanged. The AI path is purely a replacement for the final text selection step in `ShowPrompt()`.
- The dashboard requires no changes.
- Event-only mode bypasses AI generation entirely — the exposition string is always synchronous.
- The `channel_notes.json` file (currently unused by the plugin) gets a real job: its style profile for the active channel feeds the system prompt.

### Files Affected

- `Settings.cs` — two new fields
- `Control.xaml` / `Control.xaml.cs` — API key input + AI toggle
- `Engine/CommentaryGenerator.cs` — new file, async Anthropic API wrapper
- `Engine/CommentaryEngine.cs` — `ShowPrompt()` calls `CommentaryGenerator` when AI is enabled, handles callback
- `RaceCorProDrive.Plugin.csproj` — add `System.Net.Http` reference if not already present

---

## Version 1.5: Haiku-Expanded Deterministic Expressions + Data Threshold Fixes

Live Haiku API integration (Version 2.0) is deferred. Instead, we use Haiku **offline** to pre-generate a much larger, richer pool of deterministic commentary expressions that are assembled from composable sentence fragments at runtime. This gives us the variety of AI-generated text without runtime latency, network dependency, or API costs.

### Architecture: Composable Sentence Fragments

Inspired by Crew Chief v4's audio fragment composition system (where individual audio clips are composed at runtime from folder hierarchies of pre-recorded fragments), we break commentary text into three composable parts:

**Fragment structure per topic:**

```json
{
  "id": "position_lost",
  "fragments": {
    "openers": [
      "Lost that one.",
      "They got through.",
      "Position gone.",
      "That's a place dropped."
    ],
    "bodies": [
      "{behind} found the gap and took it — {rating_context}.",
      "Got outbraked into the corner by {behind}.",
      "{behind} had the run on me down the straight.",
      "Couldn't defend that — {behind} was just faster through that section."
    ],
    "closers": [
      "Need to respond, not react.",
      "Figure out where I gave them the opportunity.",
      "The gap behind is what matters now.",
      "Dig in and close it down.",
      ""
    ]
  }
}
```

At runtime, the engine randomly selects one opener + one body + one closer and joins them. This gives N×M×K combinations per topic (e.g., 4×4×5 = 80 unique expressions from just 13 fragments). The `commentaryPrompts` array is retained as a fallback for topics that haven't been converted to fragments.

**New class: `FragmentAssembler`** — lives in `Engine/FragmentAssembler.cs`. Responsible for:

1. Loading fragment data from `commentary_fragments.json` (new dataset file)
2. Assembling a complete sentence from opener + body + closer with proper spacing
3. Performing placeholder substitution ({ahead}, {behind}, {value}, {rating_context}, {corner_name})
4. Tracking recently-used fragments per-topic to avoid immediate repetition (ring buffer of last 3 per slot)

**New dataset file: `racecorprodrive-data/commentary_fragments.json`**

Contains fragment pools for all topics. Generated with Haiku using the existing `commentaryPrompts` as style reference and `channel_notes.json` + content from http://www.alternate.org for voice matching. Each topic gets at minimum 6 openers, 8 bodies, and 5 closers (= 240+ unique combinations per topic, vs the current 4-5 static prompts).

### Haiku Generation Process

A one-time batch generation script (`tools/generate_fragments.py`) calls `claude-haiku-4-5` with:

1. The full `commentary_topics.json` as context
2. The `sentiments.json` phrase library as voice/tone reference
3. The `channel_notes.json` style profiles
4. Instructions to generate fragments in Kevin's voice: first person, present tense, technically grounded, direct, no filler

The script outputs `commentary_fragments.json`. This can be re-run anytime to refresh the fragment pool.

### CommentaryEngine Changes

In `ShowPrompt()`:
1. Check if `FragmentAssembler` has fragments for the topic ID
2. If yes: assemble from fragments (with placeholder substitution)
3. If no: fall back to the existing `commentaryPrompts` random selection
4. All existing severity, cooldown, and interruption logic is unchanged

### Data Threshold Fixes

**Critical inversion bug: TyreWear values**

iRacing's `TyreWearFrontLeft` (and all wear fields) reports **remaining tyre life** as a 0.0–1.0 fraction: 1.0 = brand new, 0.0 = destroyed. The current trigger `> 0.65` fires when 65% life **remains** (only 35% worn), which is far too early and was causing "high tyre wear" prompts on nearly-new tyres.

Fix: Change condition to `< 0.35` — fires when less than 35% life remaining (= 65% worn). Update the exposition text to say "remaining" not "worn", or invert the displayed percentage.

**Threshold adjustments (values were too sensitive, causing false positives):**

| Topic | Data Point | Old Threshold | New Threshold | Reason |
|---|---|---|---|---|
| `kerb_hit` | VertAccel spike | thresholdDelta: 7.0 | thresholdDelta: 10.0 | Normal bumps were triggering; 10G is a genuine hard kerb |
| `ffb_torque_spike` | SteeringWheelTorque spike | thresholdDelta: 18.0 | thresholdDelta: 25.0 | Normal cornering forces were triggering |
| `spin_catch` | YawRate extreme | absValue: 2.5 | absValue: 3.0 | Fast chicanes produce 2.5 normally; 3.0 is genuine snap |
| `close_battle` | close_proximity | proximityThreshold: 0.01 | proximityThreshold: 0.008 | 1% track distance is too generous; 0.8% is real door-to-door |
| `tyre_wear_high` | TyreWearFL/FR/RL | condition: ">", value: 0.65 | condition: "<", value: 0.35 | **INVERTED** — was checking remaining life, not wear |
| `hot_tyres` | TyreTempFL/FR | value: 115 | value: 250 | Temps are in °F; 250°F (~121°C) is genuine overheating |
| `heavy_braking` | LongAccel | value: -32.0 | value: -38.0 | -32 m/s² (~3.3G) is routine; -38 (~3.9G) is genuine heavy braking |
| `high_cornering_load` | LatAccel | value: 4.0 | value: 4.5 | 4.0G is achievable in many corners; 4.5G is truly exceptional |
| `car_balance_sustained` | LatAccel | value: 3.5 | value: 4.0 | Same reasoning — raise to avoid over-triggering |
| `qualifying_push` | LapDeltaToBest | value: -0.4 | value: -0.6 | -0.4s is common lap-to-lap variance; -0.6s is a genuine hot lap |

**Tyre wear exposition text fix:**
- Old: "High tyre wear — front left at {value}% worn, grip is degrading"
- New: "High tyre wear — front left at {value}% life remaining, grip is degrading"

### Sentiment Color Format Fix

SimHub dashboard properties expect colors in `#AARRGGBB` format (8-digit with alpha). The `NormalizeColor()` method in `CommentaryEngine.cs` already handles conversion from `#RRGGBB` → `#FFRRGGBB`, but the `sentiments.json` file uses raw `#RRGGBB`. The conversion is working correctly in code; if colors still don't appear in the dashboard, the issue is likely in how the dashboard reads the property. The plugin should output colors in `#AARRGGBB` format consistently (which it does via `NormalizeColor`). If SimHub's dashboard engine doesn't support 8-digit hex, we should also expose a separate RGB-only property as a fallback.

### Files Affected

- `Engine/FragmentAssembler.cs` — **new file**, fragment loading + assembly + repetition tracking
- `Engine/CommentaryEngine.cs` — `ShowPrompt()` calls `FragmentAssembler` before falling back to static prompts
- `Models/CommentaryTopic.cs` — add `Fragments` property (optional, parallel to `CommentaryPrompts`)
- `racecorprodrive-data/commentary_fragments.json` — **new file**, Haiku-generated fragment pools
- `racecorprodrive-data/commentary_topics.json` — threshold fixes, exposition text fixes, tyre wear inversion fix
- `tools/generate_fragments.py` — **new file**, batch Haiku generation script

### What Doesn't Change

- The trigger system, severity system, interruption logic, cooldowns, and feedback engine are unchanged
- The dashboard requires no changes (it reads the same properties)
- Event-only mode still uses the existing exposition strings
- Demo mode continues to work as-is
- The Version 2.0 live AI architecture remains a future option; fragments are the immediate path

---

## Alpha Testing Results

1. colors still don't show up in the sentiment box. does simhub support hex8, the color format you're using? it doesn't seem to, or the values don't come through correctly. don't update the dashboard here, just the plugin.
2. i'd like a lot more attention paid to catastrophic events, like crashes into walls, going off tracks, and being passed.
3. another enhancement i'd like to see is including the names of the corner or straight i'm currently on (if more than simply T1, etc) as an extra displayable data point. bonus points if you can make the prompts include these circuit position names.
4. let's tune the events a little bit, their data thresholds are too low. you're telling me that i slipped or that the wheel had a large spike in feedback when it didn't really happen that strongly.
5. some positive notes to keep up/enhance: the timing at 15 seconds was much better this time; the wording of the prompts, while true to the source material could use some voicing, particularly from my own website at http://www.alternate.org
6. let's also include the sentiment text within the variable that displays the category name - no new variable to display, just additional text in the displayed value, if possible.
7. include more track incidents in the event system: unsafe conditions (gravel on the road, etc), accidents ahead and behind.
8. if i'm being passed or passing someone, tell me their name and rating in the prompt text. include context on whether they're passing or i am.
