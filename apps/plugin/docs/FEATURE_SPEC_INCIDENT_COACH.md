# Feature Spec: Incident Coach & Driver Behavior System

**Status:** Proposal
**Author:** Kevin / Claude
**Date:** 2026-04-06
**Modules affected:** Plugin (C#), Overlay (JS), Settings
**Research basis:** Abou-Zeid et al. (2011), Kerwin & Bushman (2022)
**Skill reference:** `.claude/skills/incident-coach/SKILL.md`

---

## Research Foundation

This spec is grounded in two academic studies on driving aggression in simulator environments:

1. **Abou-Zeid, Kaysi & Al-Naghi (2011)** — Established measurable indicators of aggressive
   driving behavior (velocity, acceleration, following distance, lane deviation) and demonstrated
   the frustration-aggression cascade: even non-aggressive drivers become aggressive after
   frustrating events.

2. **Kerwin & Bushman / Ohio State (2022)** — Identified risk factors (trait anger, narcissism,
   hostile attribution bias) and protective factors (mindfulness, empathy) for aggressive driving.
   Established following distance as the primary aggression metric with 4s/3s/2s threshold tiers.
   Critically: hostile attribution bias (perceiving ambiguous actions as intentional) is a strong
   predictor of retaliation. Our voice prompts must never reinforce this bias.

Key principles derived from the research:
- **Frustration cascades**: After the first incident, lower all thresholds by 15% per subsequent
  incident. Even calm drivers escalate with repeated provocation.
- **Never reinforce hostile attribution**: Voice prompts must not imply intent. "Contact with
  [Name]" not "He brake-checked you." The system de-escalates the narrative.
- **Mindfulness as intervention**: Redirect focus to the present driving task, not the past
  incident. Breathing cues use the 4-7-8 pattern (4s in, 7s hold, 8s out).
- **Empathy in recovery only**: Empathy prompts ("Maybe they're having a rough race too")
  help during cool-down but can backfire during active rage.
- **Positive reinforcement**: "Three clean laps since the incident" — measurable non-aggressive
  behavior should be acknowledged.

---

## Problem Statement

When another driver makes contact — brake-checks, pushes off track, dive-bombs — the natural
response is anger. Right now the only coping mechanism is pitting to remove yourself from the
situation, which throws away race position and doesn't address the underlying pattern. We need
a system that:

1. **Knows who did it** — not just that contact happened, but _which_ driver caused it
2. **Remembers them** — tracks problem drivers across the session
3. **Warns you proactively** — alerts when you're approaching a flagged driver
4. **Intervenes actively** — uses voice, visuals, and input coaching to break the rage cycle
5. **Analyzes your behavior** — both in real-time and post-session, to help you improve over time

The system must be fully toggleable via a single master setting.

---

## 1. Incident Attribution Engine (Plugin — C#)

### 1.1 Contact Detection

The foundation. iRacing increments `IncidentCount` on any contact (1x, 2x, 4x). We detect
the delta each poll cycle:

```
incidentDelta = currentIncidentCount - previousIncidentCount
```

When `incidentDelta > 0`, we have an **Incident Event**. The delta size hints at severity:
- **1x** — minor brush / off-track from proximity pressure
- **2x** — car-to-car contact
- **4x** — heavy contact or wall hit from being pushed

### 1.2 Proximity Snapshot

On every incident event, capture a **proximity snapshot** of all cars using `CarIdxLapDistPct[]`:

```csharp
public class ProximitySnapshot
{
    public double Timestamp;
    public int PlayerCarIdx;
    public double PlayerLapDistPct;
    public double PlayerSpeed;           // from SpeedKmh
    public double PlayerLatAccel;        // lateral G at moment of contact
    public double PlayerLongAccel;       // longitudinal G (braking/accel)
    public double PlayerYawRate;         // spin detection
    public int IncidentDelta;            // 1x, 2x, or 4x
    public List<NearbyDriver> NearbyDrivers;
}

public class NearbyDriver
{
    public int CarIdx;
    public string Name;
    public int IRating;
    public double LapDistPct;
    public double GapToPlayer;           // seconds, signed (+ = ahead, - = behind)
    public double RelativeSpeed;         // closing rate
    public bool OnPitRoad;
    public double TrackDistanceMeters;   // approximate distance in meters
}
```

### 1.3 Attribution Algorithm

Not every nearby car caused the incident. The algorithm scores each nearby driver:

**Proximity Score (0–40 points)**
- Within 0.2s gap: 40 pts
- Within 0.5s gap: 30 pts
- Within 1.0s gap: 15 pts
- Beyond 1.0s: 0 pts (bystander)

**Relative Position Score (0–30 points)**
- For 2x/4x incidents (car contact): favor the car closest in `LapDistPct`
- If player `LatAccel` spike is positive (pushed right), favor car on the left (slightly behind in LapDistPct on a left-hand turn, or slightly ahead on a right-hand turn)
- If player `LongAccel` spike is negative (rear-ended or brake-checked), favor car directly behind
- If player `YawRate` spike (spin), favor the car with highest closing speed

**Behavioral Context Score (0–30 points)**
- Driver already flagged this session: +15 pts (repeat offender)
- Incident occurred under braking zone (player `Brake > 50`): +10 pts for car behind (likely dive-bomb or brake-check response)
- Incident on straight (no significant `LatAccel`): +10 pts for car alongside (squeeze)
- Car was closing rapidly (`RelativeSpeed > 20 km/h`): +10 pts

**Attribution Result:**
- Highest-scoring driver with score ≥ 40: **Primary suspect** — tagged as incident partner
- Score 25–39: **Possible contributor** — flagged but not highlighted
- Score < 25: **Bystander** — no action

### 1.4 Driver Threat Ledger

Persist per-session (reset on new session):

```csharp
public class DriverThreatEntry
{
    public int CarIdx;
    public string Name;
    public int IRating;
    public int IncidentCount;           // total incidents attributed to this driver
    public int TotalIncidentPoints;     // sum of 1x/2x/4x attributed
    public List<double> IncidentLaps;   // lap numbers where incidents occurred
    public DateTime LastIncidentTime;
    public ThreatLevel Level;           // None, Watch, Caution, Danger
}

public enum ThreatLevel
{
    None,       // no attributed incidents
    Watch,      // 1 incident (1x-2x) — informational
    Caution,    // 2+ incidents OR 1 heavy (4x) — active warnings
    Danger      // 3+ incidents OR 2+ heavy — full intervention mode
}
```

Threat level escalation is one-directional within a session — it never decreases. Once someone
is flagged Danger, they stay Danger. This is intentional: the point is to protect you from your
own reactions, and a repeat offender doesn't become safe just because a few laps pass.

---

## 2. Proximity Alert System (Plugin → Overlay)

### 2.1 Threat Proximity Monitor

Every poll cycle, check if a flagged driver is within engagement range:

| Threat Level | Alert Range | Action |
|:-------------|:------------|:-------|
| Watch        | < 1.5s gap  | Subtle highlight on leaderboard + track map |
| Caution      | < 2.5s gap  | Amber highlight + spotter message + optional voice |
| Danger       | < 3.5s gap  | Red highlight + voice warning + cool-down prep |

### 2.2 New Plugin Properties

Exposed via the HTTP API alongside existing telemetry:

```
RaceCorProDrive.Plugin.DS.IncidentCoach.Active           // bool — master toggle
RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentAt    // lap number of last incident
RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers     // JSON array of threat entries
RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert       // current alert state JSON
RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore         // 0-100 composite score
RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive    // bool
RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior   // JSON behavior summary
```

---

## 3. Voice Coaching System (Overlay — JS)

### 3.1 Technical Implementation

Using the Web Speech API (`SpeechSynthesis`) available in Electron/Chromium:

```javascript
// voice-coach.js — new overlay module

const _voiceCoach = {
    synth: window.speechSynthesis,
    voice: null,          // selected voice (prefer calm, low-pitch)
    enabled: true,
    volume: 0.7,          // default — configurable
    rate: 0.9,            // slightly slower than default for calm delivery
    pitch: 0.85,          // slightly lower pitch
    queue: [],            // utterance queue with priority
    lastSpoke: 0,         // timestamp — minimum gap between utterances
    minGap: 3000,         // 3 seconds minimum between voice prompts
};
```

### 3.2 Voice Selection

On init, scan available voices and prefer:
1. Voices with "Daniel", "Aaron", "James" in the name (tend to be calm male voices)
2. Any `en-US` or `en-GB` voice with a low default pitch
3. Fallback to system default

User can override in settings.

### 3.3 Utterance Priority System

Voice prompts have priority levels that mirror the commentary engine's severity system:

| Priority | Use Case | Example | Can Interrupt |
|:---------|:---------|:--------|:--------------|
| 1 — Info | Position updates near flagged driver | "Driver ahead is flagged." | No |
| 2 — Advisory | Entering alert range | "Caution. [Name] is 1.5 seconds ahead. Last contact was lap 12." | No |
| 3 — Warning | Close proximity to danger driver | "Back off. Give yourself space." | Yes (P1) |
| 4 — Urgent | Rage pattern detected | "Hey. Breathe. This isn't worth your race." | Yes (P1–P2) |
| 5 — Critical | Imminent retaliation detected | "Pit lane is open. Let's reset. You've got this." | Yes (all) |

### 3.4 Message Templates

Dynamic, not robotic. The system randomly selects from pools per situation:

**Approaching flagged driver:**
- "Heads up — [Name] is [gap] seconds [ahead/behind]."
- "[Name] incoming. Stay smooth."
- "Flagged driver [ahead/behind]. You know the drill."

**Contact just happened (immediate):**
- "Contact. [Name] tagged. Let's keep racing."
- "Incident logged. Focus forward."
- "That's on them. Don't give them another one."

**Rage pattern detected:**
- "Hey. Breathe. You're better than this."
- "Slow hands. Smooth inputs. Let it go."
- "Think about your safety rating. Not worth it."
- "Remember — the best revenge is a clean finish ahead of them."

**Cool-down mode active:**
- "Cool-down active. Holding steady for [X] seconds."
- "Easy laps. Let the gap grow."

---

## 4. Rage Detection & Active Intervention (Plugin + Overlay)

### 4.1 Rage Score Computation

A composite score (0–100) computed from driver inputs post-incident:

```
RageScore = W1 * ThrottleAggression
          + W2 * SteeringErraticism
          + W3 * BrakingAggression
          + W4 * ProximityChasing
          + W5 * RecencyDecay
```

**ThrottleAggression (0–25):** Sustained full-throttle (>95%) within 3 seconds of incident,
especially when closing on the incident partner.

**SteeringErraticism (0–20):** High-frequency steering input changes (derivative of
`SteeringWheelAngle`) compared to rolling average. Angry drivers saw at the wheel.

**BrakingAggression (0–20):** Late, hard braking (>90%) approaching the incident partner,
especially if it deviates from the driver's own recent braking patterns at that track position.

**ProximityChasing (0–25):** Actively closing the gap to a flagged driver faster than the
driver's normal closing rate. The system learns your typical gap behavior and flags deviations.

**RecencyDecay (multiplier: 1.0 → 0.3):** All scores decay over 30 seconds post-incident.
Rage that doesn't cool in 30 seconds gets sustained attention.

**FrustrationCascade (multiplier):** Per the Abou-Zeid (2011) frustration-aggression cascade
finding, each incident in a session lowers the effective threshold for intervention:
`effectiveThreshold = baseThreshold * (0.85 ^ sessionIncidentCount)`. After 3 incidents,
the threshold is ~61% of baseline. This models the research finding that even non-aggressive
drivers escalate with repeated provocation.

### 4.2 Intervention Tiers

| Rage Score | Tier | Actions |
|:-----------|:-----|:--------|
| 0–30 | **Calm** | Normal operation. No intervention. |
| 31–50 | **Elevated** | Spotter message + voice advisory. Flagged driver highlighted amber on track map and leaderboard. |
| 51–70 | **Active** | Voice warning. Screen edge vignette (amber glow). Gap recommendation displayed. Gentle "ease off" coaching. |
| 71–85 | **Critical** | Voice urgent prompt. Screen vignette deepens (red pulse). Suggested pit-in message. Throttle input visualization shows your aggression pattern. |
| 86–100 | **Override** | Full cool-down mode. Sustained voice coaching. Pit recommendation with estimated position loss. All UI elements shift to de-escalation. Speed delta to flagged driver shown prominently. |

### 4.3 Cool-Down Mode

When rage score exceeds 70 (or user manually triggers it), the system enters **cool-down mode**:

**Visual:**
- Screen edges get a soft, pulsing vignette (not blocking visibility — think Instagram filter, not blackout)
- Color palette shifts from race-adrenaline (reds/oranges) to calming tones (deep blue/teal)
- The flagged driver's dot on the track map gets a "danger zone" radius ring — visual reminder to maintain distance

**Behavioral:**
- Voice coach delivers a breathing cue: "Breathe in... and out. Focus on your line."
- A **gap target** appears on the HUD: "Target gap to [Name]: 3.0s" with a live counter
- When the gap reaches the target: "Good. Gap established. Back to racing."

**Duration:**
- Minimum 20 seconds
- Extends if rage score stays above 50
- Exits when rage score drops below 30 AND gap to flagged driver > 2.5s

### 4.4 Manual Cool-Down Trigger

Because sometimes you *know* you're about to lose it before the algorithm catches on:

- **Keyboard shortcut:** Configurable (default: `Ctrl+Shift+C`)
- **Voice command** (stretch goal): "Cool down" via Web Speech Recognition API
- Immediately enters cool-down mode regardless of rage score

---

## 5. Racing Behavior Analysis

### 5.1 Real-Time Behavior Metrics (Plugin)

Tracked continuously during the session:

```csharp
public class BehaviorMetrics
{
    // Aggression
    public int HardBrakingEvents;          // brake > 90% within 1s of a nearby car
    public int ClosePassCount;             // passed within 0.3s gap
    public int TailgatingSeconds;          // time spent < 0.5s behind another car
    public double AvgGapWhenOvertaking;    // how close you typically pass

    // Consistency
    public double LapTimeVariance;         // std deviation of clean lap times
    public int OffTrackCount;              // off-track events (VertAccel spike)
    public int SpinCount;                  // YawRate spike events
    public double CleanLapPercentage;      // laps without incidents / total laps

    // Racecraft
    public int PositionsGainedClean;       // positions gained without incident
    public int PositionsLostToIncident;    // positions lost within 10s of an incident
    public double AvgIncidentGap;          // average gap to nearest car at incident time
    public int DefensiveMoveCount;         // sudden lane changes when car is within 0.5s behind

    // Emotional
    public int RageSpikes;                 // times rage score exceeded 50
    public int CooldownsTriggered;         // manual or automatic
    public double AvgRageRecoveryTime;     // seconds from peak rage to calm
    public int RetaliationAttempts;        // closing on flagged driver while rage > 50
}
```

### 5.2 Real-Time Coaching Prompts

Based on live behavior metrics, the system offers proactive coaching (not just reactive to incidents):

**Tailgating detection:**
- "You've been within half a second of [Name] for [X] seconds. Either commit to the pass or build a gap."

**Braking pattern change:**
- "You're braking 15 meters later than your average into Turn [X]. Smooth inputs."

**Driving quality after incident:**
- "Your last 3 laps averaged 1.2 seconds off your best. The incident is costing you pace. Reset mentally."

**Positive reinforcement:**
- "Clean pass on [Name]. Nicely done."
- "Three clean laps since the incident. That's how you race."
- "Gap to [Name] is growing. Smart driving."

### 5.3 Post-Session Debrief

After the session ends (checkered flag + cooldown), generate a **Behavior Report**:

```
RaceCorProDrive.Plugin.DS.IncidentCoach.SessionReport  // JSON
```

**Report Structure:**

```json
{
    "session": {
        "track": "Spa-Francorchamps",
        "car": "Ferrari 296 GT3",
        "date": "2026-04-06T14:30:00Z",
        "laps": 22,
        "duration_minutes": 38,
        "finish_position": 7,
        "start_position": 12
    },
    "behavior_score": 72,
    "breakdown": {
        "aggression": 35,
        "consistency": 78,
        "racecraft": 81,
        "composure": 55
    },
    "incidents": [
        {
            "lap": 4,
            "type": "2x",
            "partner": "John Smith",
            "attribution": "incoming",
            "rage_peak": 62,
            "recovery_seconds": 18,
            "positions_lost": 1
        }
    ],
    "patterns": [
        "Your braking aggression increases 40% in the 2 laps after contact.",
        "You tend to tailgate more in the final third of the race.",
        "Clean lap percentage dropped from 90% to 60% after your first incident."
    ],
    "improvements": [
        "Practice the 3-second rule: after contact, count to 3 before any overtake attempt.",
        "Your composure score would jump to 70+ if you maintained gap targets post-incident.",
        "Consider the manual cool-down button — you had 2 rage spikes that self-corrected slowly."
    ],
    "highlights": [
        "Gained 5 positions cleanly in the first 4 laps.",
        "Recovered from incident on lap 4 to finish P7 — solid damage limitation.",
        "No retaliation attempts despite 2 contacts from the same driver."
    ]
}
```

### 5.4 Post-Session Overlay Screen

New panel in the existing `race-results.js` module:

- **Behavior Score** — large number with color (green/amber/red) and trend vs last 5 sessions
- **Breakdown radar chart** — aggression, consistency, racecraft, composure (4 axes)
- **Incident timeline** — horizontal bar showing laps with incident markers, rage score overlaid
- **Key insights** — 2–3 bullet points from the patterns/improvements arrays
- **Flagged drivers summary** — who caused trouble, how many incidents, their iRating

---

## 6. UI Elements

### 6.1 Leaderboard Enhancements

Flagged drivers get visual markers on the existing leaderboard:

- **Watch** — small eye icon next to name
- **Caution** — amber left border + warning triangle icon
- **Danger** — red left border + pulsing danger icon + name highlighted

### 6.2 Track Map Enhancements

On the existing track map:

- **Flagged driver dots** change color (white → amber → red) by threat level
- **Danger zone ring** — red translucent circle around Danger-level drivers
- **Approach indicator** — when closing on a flagged driver, a dashed line connects your dot to theirs with closing speed displayed

### 6.3 Gap Display Enhancements

When the nearest driver (ahead or behind) is flagged:

- Gap panel border changes to match threat level color
- Threat level badge appears (eye / triangle / exclamation)
- If rage score > 50: gap panel shows **target gap** instead of just current gap

### 6.4 New: Composure Indicator

A small, persistent UI element (bottom-center or near incidents panel):

- **Calm (0–30):** green dot, barely noticeable — "All clear"
- **Elevated (31–50):** amber pulse — subtle "be aware"
- **Active (51–70):** amber ring expanding — "take a breath"
- **Critical (71+):** red pulse with breathing animation — circle expands and contracts at 4-second breathing rhythm to guide the driver

### 6.5 Cool-Down Vignette

CSS-driven overlay effect:

```css
.cooldown-vignette {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9998;
    background: radial-gradient(
        ellipse at center,
        transparent 60%,
        rgba(0, 60, 90, 0.15) 80%,
        rgba(0, 40, 70, 0.3) 100%
    );
    animation: cooldown-breathe 4s ease-in-out infinite;
    transition: opacity 1s ease;
}

@keyframes cooldown-breathe {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1.0; }
}
```

Important: the vignette must NEVER obstruct the racing line or mirrors. It's peripheral only.

### 6.6 Incident Flash Overlay

When contact is detected, a brief directional flash indicates where the hit came from:

- Left side flash: contact from the left
- Right side flash: contact from the right
- Rear flash: rear-ended
- Based on `LatAccel` sign and `LongAccel` at impact moment

---

## 7. Settings & Configuration

### 7.1 Master Toggle

```
Settings → Incident Coach → Enable/Disable
```

Single toggle that controls the entire system. When disabled:
- No threat tracking
- No rage scoring
- No voice prompts
- No visual modifications to existing UI elements
- No behavior analysis
- Properties still exposed but all return defaults/zeros

### 7.2 Granular Settings

All under the Incident Coach section, only visible when master toggle is on:

| Setting | Type | Default | Description |
|:--------|:-----|:--------|:------------|
| Voice Prompts | Toggle | On | Enable/disable voice coaching |
| Voice Volume | Slider | 70% | TTS volume level |
| Voice Selection | Dropdown | Auto | Choose TTS voice |
| Cool-Down Mode | Toggle | On | Enable automatic cool-down activation |
| Cool-Down Threshold | Slider | 70 | Rage score that triggers auto cool-down |
| Manual Cool-Down Key | Key bind | Ctrl+Shift+C | Shortcut for manual cool-down |
| Visual Alerts | Toggle | On | Threat highlights on leaderboard/map |
| Vignette Effect | Toggle | On | Screen edge effect during cool-down |
| Composure Indicator | Toggle | On | Show/hide the composure dot |
| Post-Session Report | Toggle | On | Generate behavior report after session |
| Positive Reinforcement | Toggle | On | "Nice pass" / "clean driving" prompts |
| Alert Sensitivity | Low/Med/High | Medium | How aggressively the system flags threats |

### 7.3 SimHub Settings Panel

Exposed in the SimHub plugin settings UI:

```csharp
public class IncidentCoachSettings
{
    [Display(Name = "Enable Incident Coach")]
    public bool Enabled { get; set; } = false;  // off by default — opt-in

    [Display(Name = "Voice Coaching")]
    public bool VoiceEnabled { get; set; } = true;

    [Display(Name = "Cool-Down Auto-Trigger Threshold")]
    [Range(40, 90)]
    public int CooldownThreshold { get; set; } = 70;

    [Display(Name = "Alert Sensitivity")]
    public AlertSensitivity Sensitivity { get; set; } = AlertSensitivity.Medium;

    // ... etc
}
```

**Default: OFF.** The system is opt-in. Nobody wants surprise voice prompts the first time
they load the plugin. The settings panel includes a brief description: *"Incident Coach tracks
driver contacts, warns you about problem drivers, and helps you stay composed when things get
heated. Voice coaching guides you through tense moments."*

---

## 8. Data Flow Summary

```
iRacing SDK
    │
    ▼
TelemetrySnapshot.Capture()
    │
    ├─── IncidentCount delta detected?
    │         │
    │         ▼
    │    ProximitySnapshot → Attribution Algorithm → DriverThreatLedger
    │
    ├─── RageScoreEngine.Update() ← (throttle, steering, brake, gap data)
    │         │
    │         ▼
    │    RageScore 0-100 → Intervention tier
    │
    ├─── BehaviorMetrics.Update() ← (all driving inputs + positions)
    │
    ▼
HTTP API (port 8889)
    │
    ▼
Overlay poll-engine.js
    │
    ├─── incident-coach.js (new module)
    │         ├── Parse ThreatDrivers JSON
    │         ├── Update leaderboard/map highlights
    │         ├── Manage composure indicator
    │         └── Trigger cool-down vignette
    │
    ├─── voice-coach.js (new module)
    │         ├── Process ActiveAlert state
    │         ├── Queue utterances by priority
    │         └── Deliver TTS prompts
    │
    └─── race-results.js (extended)
              └── Render post-session behavior report
```

---

## 9. iRacing-First, Abstraction-Ready

### 9.1 Sim Abstraction Interface

```csharp
public interface IIncidentDetector
{
    bool IsContactDetected(TelemetrySnapshot current, TelemetrySnapshot previous);
    int GetIncidentSeverity();
    List<NearbyDriver> GetNearbyDrivers(TelemetrySnapshot snapshot);
}
```

**iRacing implementation:** Full-featured, uses `IncidentCount`, `CarIdxLapDistPct[]`,
`CarIdxOnPitRoad[]`, opponent names/iRatings.

**Generic implementation (future):** Uses physics heuristics only — `LatAccel` spikes,
`LongAccel` anomalies, `VertAccel` for off-tracks. Limited to nearest-ahead / nearest-behind
from SimHub normalized data. No multi-car attribution — falls back to "nearest car" as suspect.

### 9.2 Feature Degradation by Sim

| Feature | iRacing | Other Sims (future) |
|:--------|:--------|:--------------------|
| Incident detection | SDK incident count | Physics heuristics |
| Multi-car attribution | Full (CarIdx arrays) | Nearest car only |
| Driver names | Full field | Ahead + behind only |
| iRating display | Yes | No (or sim equivalent) |
| Rage detection | Full | Full (input-based) |
| Voice coaching | Full | Full |
| Behavior analysis | Full | Reduced (fewer data points) |
| Post-session report | Full | Basic |

---

## 10. Implementation Priority

### Phase 1 — Foundation
- [ ] `IIncidentDetector` interface + iRacing implementation
- [ ] `ProximitySnapshot` capture on incident delta
- [ ] Attribution algorithm (scoring)
- [ ] `DriverThreatLedger` with threat level escalation
- [ ] New HTTP properties exposed
- [ ] Master toggle in SimHub settings
- [ ] Overlay: parse threat data, highlight leaderboard entries

### Phase 2 — Voice & Alerts
- [ ] `voice-coach.js` module with Web Speech API
- [ ] Voice selection and settings
- [ ] Utterance priority queue
- [ ] Message template pools
- [ ] Spotter integration (threat approach messages)
- [ ] Track map threat coloring

### Phase 3 — Rage Detection & Intervention
- [ ] `RageScoreEngine` in plugin
- [ ] Input analysis (throttle aggression, steering erraticism, etc.)
- [ ] Composure indicator UI element
- [ ] Cool-down mode (vignette + voice + gap target)
- [ ] Manual cool-down shortcut
- [ ] Intervention tier escalation

### Phase 4 — Behavior Analysis
- [ ] `BehaviorMetrics` continuous tracking
- [ ] Real-time coaching prompts (tailgating, braking, positive reinforcement)
- [ ] Post-session report generation
- [ ] Behavior report overlay panel in race-results
- [ ] Session-over-session trend tracking (local storage)

### Phase 5 — Polish & Other Sims
- [ ] Incident flash directional overlay
- [ ] Breathing animation on composure indicator
- [ ] Approach indicator on track map
- [ ] Generic `IIncidentDetector` for non-iRacing sims
- [ ] Voice command: "cool down" trigger
- [ ] Fine-tuning attribution weights from real race data
