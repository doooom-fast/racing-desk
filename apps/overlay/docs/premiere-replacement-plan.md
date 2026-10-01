# RacingDesk Editor — AI-Powered Race Edit Pipeline

**Status:** Implemented  
**Author:** kevin  
**Date:** April 15, 2026  
**Implementation docs:** [RACECOR_EDIT.md](RACECOR_EDIT.md), [docs/recording.md](../../../docs/recording.md) (recording is OBS's now)

---

## Goal

Replace Adobe Premiere Pro with an automated editing pipeline that uses Claude AI and sim racing telemetry to produce broadcast-quality race edits — including the hardest part: **knowing when to cut between cockpit view and TV/third-person broadcast camera.**

This is not about building a general-purpose video editor. It's about building a purpose-built race editing pipeline that understands racing and makes the same decisions a broadcast director would.

---

## The Core Problem: Camera Switching

Real racing broadcasts (F1, IndyCar, IMSA) have a team of directors making split-second decisions about which camera to show. When you're editing sim racing footage, you're doing this alone, scrubbing through hours of footage trying to find:

- When an overtake is developing (switch to TV view to see both cars)
- When you're in clean air and nothing's happening (stay cockpit, or cut entirely)
- When an incident is about to happen nearby (TV view for context)
- When to show pit entry/exit (TV view for the stop, cockpit for the release)
- Start/restart sequences (TV view for the field, cockpit for your launch)

**This is the single most time-consuming part of race video editing** and the overlay's telemetry data already contains every signal needed to automate it.

---

## Architecture Overview

```
WINDOWS (Recording)                    MAC (Editing)
┌──────────────────────┐              ┌──────────────────────────────┐
│  RacingDesk Overlay     │              │  RacingDesk Editor CLI          │
│                      │              │                              │
│  Records:            │   transfer   │  1. Ingest                   │
│  • Cockpit video     │ ──────────►  │     Parse telemetry JSON     │
│  • TV-view video     │              │                              │
│  • Telemetry JSON    │              │  2. Analyze (Claude API)     │
│  • Audio (game+mic)  │              │     Identify cut points      │
│                      │              │     Score each moment        │
│  Writes sidecar:     │              │                              │
│  telemetry.jsonl     │              │  3. Assemble (FFmpeg)        │
│  (per-frame data)    │              │     Execute edit decisions   │
│                      │              │     Render final video       │
└──────────────────────┘              │                              │
                                      │  4. Export                   │
                                      │     Full edit + social cuts  │
                                      └──────────────────────────────┘
```

---

## The Telemetry Sidecar: `telemetry.jsonl`

The overlay's poll engine already fetches 100+ properties at ~30fps. During recording (see OBS replacement plan), we write a subset of these to a JSON Lines file synced to video frames:

```jsonl
{"t":0.000,"frame":0,"pos":3,"gap_ahead":1.2,"gap_behind":0.8,"speed":145,"throttle":1.0,"brake":0.0,"gear":5,"rpm":7200,"incidents":0,"pit":false,"flag":"green","sector":1,"lap":1,"nearby_cars":2,"closest_car_dist":0.4,"delta_best":-0.3,"on_track":true}
{"t":0.033,"frame":1,"pos":3,"gap_ahead":1.1,"gap_behind":0.9,...}
```

Key fields for camera switching decisions:

| Field | Type | Camera Signal |
|-------|------|---------------|
| `gap_ahead` | float (seconds) | < 0.8s → battle developing → TV view |
| `gap_behind` | float (seconds) | < 0.8s → being attacked → TV view |
| `closest_car_dist` | float (car lengths) | < 1.0 → side by side → TV view |
| `pos` | int | Position changed → show the overtake → TV view |
| `incidents` | int | Increased → incident nearby → TV view |
| `pit` | bool | Entering/exiting → show the stop → TV view |
| `flag` | string | Yellow/red → show the field → TV view |
| `speed` | float | Sudden drop = off track or contact → TV view |
| `delta_best` | float | Purple sector → stay cockpit (driver's moment) |
| `on_track` | bool | False = off track → TV view to show mistake |
| `lap` | int | Lap 1 = formation/start → TV view |

---

## Two-Source Recording Strategy

You can't run cockpit and TV view simultaneously during a live race without a second iRacing account. But iRacing's built-in replay system gives us the second angle for free — after the race is over.

**Source 1: Cockpit POV (live)** — Recorded during the actual race via the overlay's built-in recorder (see OBS replacement plan). This is the player's live view with real reactions, real audio, real adrenaline. Can't be recreated.

**Source 2: TV/Broadcast View (replay)** — Recorded after the race from iRacing's replay system. The key insight: we already have the telemetry sidecar from the live recording, so we know *exactly* which moments need TV coverage before we even start the replay pass.

### The Post-Race Replay Workflow

```
1. Race ends → cockpit.mp4 + telemetry.jsonl are saved
2. Overlay immediately analyzes telemetry → identifies TV-view moments
3. Overlay presents a "Replay Recording Guide":
   
   ┌─────────────────────────────────────────────┐
   │  TV-VIEW RECORDING GUIDE                    │
   │                                             │
   │  Moments that need broadcast camera:        │
   │                                             │
   │  ✦ 0:00–0:20   Race start (lap 1, T1)      │
   │  ✦ 3:45–3:58   Battle with #4 BMW (T7)     │
   │  ✦ 8:12–8:18   Incident in T3 (nearby)     │
   │  ✦ 15:30–16:05 Pit stop                    │
   │  ✦ 42:00–42:30 Final lap battle for P5     │
   │                                             │
   │  Total TV-view footage needed: ~3 min       │
   │  [Record Full Replay] [Record Moments Only] │
   └─────────────────────────────────────────────┘

4. User hits `Ctrl+Shift+P` — the automated replay director takes over
5. Overlay opens the iRacing replay, switches to broadcast camera
6. For each TV-view moment, the overlay:
   - Jumps the replay to that timestamp (keyboard automation)
   - Starts NVENC recording
   - Plays through the moment at 1× speed
   - Stops recording (or continues to next moment in one take)
7. All TV-view footage is saved, timestamped, and ready for the editor
```

**This is fully automated.** With the 4090's NVENC encoder (zero GPU cost) and iRacing's keyboard-controllable replay system, the overlay handles the entire replay pass without any manual work. A 20-minute race with 3 minutes of TV-view moments takes about 4 minutes to process (3 min of playback + jump/settle time).

(The replay keyboard automation this pointed at was in a plan that is gone; TV shots are being rebuilt on the iRacing SDK's own replay commands — see [docs/recording.md](../../../docs/recording.md).)

### Fallback: Manual Replay Recording

If the automated director has issues (replay keyboard timing, camera not switching cleanly), the Replay Recording Guide still works as a manual fallback:

| Approach | Manual Effort | Quality | Complexity |
|----------|--------------|---------|------------|
| **Automated replay director** (default) | Zero — hit one hotkey | Best — AI picks cameras, records moments | Keyboard automation |
| **Guided manual recording** (fallback) | Low — follow the guide | Great — you control the camera | None |
| **Full replay recording** (simple) | Low — just hit record | Good — full coverage, editor picks moments | None |

---

## Claude AI Integration

This is where the pipeline gets smart. Claude analyzes the telemetry sidecar to produce an **Edit Decision List (EDL)** — a frame-accurate script of what to show when.

### How It Works

```
telemetry.jsonl ──► Claude API ──► edit-decisions.json ──► FFmpeg assembly
```

**Step 1: Telemetry summarization**

The raw JSONL is too large to send to Claude directly (~30 rows/second × 90 minutes = 162,000 rows). Pre-process it into a compact event stream:

```jsonl
{"t":"0:00","event":"race_start","pos":8,"field_size":24}
{"t":"0:12","event":"close_battle","gap_ahead":0.6,"car_ahead":"#4 BMW","duration":8.2}
{"t":"0:20","event":"position_change","old":8,"new":7,"overtake_type":"switchback"}
{"t":"1:45","event":"incident_nearby","distance":3.2,"flag":"local_yellow"}
{"t":"5:30","event":"pit_entry"}
{"t":"5:55","event":"pit_exit","pos":12,"undercut":true}
{"t":"12:00","event":"fastest_lap","time":"1:32.456","delta":-0.8}
{"t":"45:00","event":"race_end","pos":5,"laps_led":3}
```

This reduces 162K rows to maybe 50–200 events — easily fits in a Claude context window.

**Step 2: Claude generates the edit**

Prompt Claude with the event stream and a broadcast directing style guide:

```
You are a professional motorsport broadcast director editing a sim race.

Given the telemetry events below, produce an edit decision list (EDL) that 
determines which camera angle to show at each moment. Your decisions should 
feel like a real TV broadcast — show battles from TV view, show clean laps 
from cockpit, build tension before overtakes, show pit stops from TV view.

Rules:
- Default to cockpit view during clean-air laps
- Switch to TV view at least 2 seconds BEFORE a close battle begins
- Hold TV view through overtakes and 3 seconds after
- Show pit entry from cockpit, cut to TV for the stop, cockpit for release
- Race start: TV view for first 15 seconds, then cockpit
- Incidents: TV view if within 5 car lengths, cockpit if further
- Keep cuts to a minimum during fast sectors (don't distract from speed)
- For a highlight reel: skip clean-air segments entirely

Events:
{event_stream}

Output format:
{edl_schema}
```

**Step 3: EDL output**

```json
{
  "title": "IMSA Daytona 60min — P5 Finish",
  "total_duration": "45:00",
  "cuts": [
    {"start": "0:00", "end": "0:15", "source": "tv", "reason": "race start, show field"},
    {"start": "0:15", "end": "0:10", "source": "cockpit", "reason": "launch and T1 entry"},
    {"start": "0:10", "end": "0:25", "source": "tv", "reason": "close battle with #4 BMW developing"},
    {"start": "0:20", "end": "0:24", "source": "tv", "reason": "overtake — switchback into T3"},
    ...
  ],
  "highlight_reel": {
    "duration": "3:00",
    "segments": [
      {"start": "0:10", "end": "0:25", "source": "tv", "label": "Opening battle P8→P7"},
      {"start": "5:30", "end": "6:00", "source": "mixed", "label": "Pit stop undercut"},
      {"start": "12:00", "end": "12:45", "source": "cockpit", "label": "Fastest lap"},
      {"start": "44:00", "end": "45:00", "source": "mixed", "label": "Final lap P5 finish"}
    ]
  }
}
```

### Advanced Claude Features

**Commentary generation:** Claude can also write text commentary/captions for each segment, matching the race events. The overlay already has a commentary system (`commentary.js`) — this extends it to post-production.

**Music sync:** Given a BPM-analyzed music track, Claude can adjust cut timing to land on beats for highlight reels.

**Multi-race narratives:** Feed Claude telemetry from a full championship season to generate storylines ("the comeback from P15 at Spa", "the rivalry with the #4 BMW across 6 rounds").

**Thumbnail generation:** Claude can identify the most visually dramatic moment (closest side-by-side, biggest overtake) and output a timestamp for FFmpeg to extract as a thumbnail.

---

## The Editor CLI: `racing-desk-edit`

A Node.js command-line tool that runs on macOS. Not a GUI editor — it's a pipeline that takes raw recordings and produces finished edits.

### Commands

```bash
# Ingest a recording session
racing-desk-edit ingest ./race-2026-04-15/
  # Reads: cockpit.mp4, tv-view.mp4, telemetry.jsonl, audio.aac
  # Outputs: session.json (metadata + event summary)

# Generate edit decisions using Claude
racing-desk-edit analyze ./race-2026-04-15/
  # Calls Claude API with event stream
  # Outputs: edit-decisions.json
  # Interactive: shows proposed cuts, lets you approve/modify

# Preview the edit (low-res, fast)
racing-desk-edit preview ./race-2026-04-15/
  # FFmpeg generates 480p preview with burn-in timecodes
  # Opens in default video player

# Render the final edit
racing-desk-edit render ./race-2026-04-15/ --output final.mp4
  # FFmpeg assembles full-res edit with transitions
  # Options: --quality [draft|final], --resolution [1080|4k]

# Condense a race to a target duration (the magic command)
racing-desk-edit condense ./race-2026-04-15/ --target 5:00
  # Scores every second for "interest" using telemetry + audio
  # Cuts boring stretches (clean air, no commentary, no battles)
  # Claude adds context bridges between kept segments
  # FFmpeg renders the condensed edit

racing-desk-edit condense ./race-2026-04-15/ --target 3:00 --social
  # Even tighter, with captions + position badge
  # Exports both 16:9 and 9:16

# Generate social media clips
racing-desk-edit clips ./race-2026-04-15/
  # Uses highlight_reel from edit decisions
  # Outputs: highlights-16x9.mp4, highlights-9x16.mp4
  # Auto-adds captions, position badge, track name

# Manual override: open in DaVinci Resolve
racing-desk-edit export-timeline ./race-2026-04-15/ --format fcpxml
  # Exports the EDL as a Final Cut/DaVinci Resolve timeline
  # All cuts pre-made, you just polish in the GUI editor
```

### Tech Stack

| Component | Tool | Why |
|-----------|------|-----|
| Runtime | Node.js 20+ | Matches overlay's ecosystem |
| AI | Claude API (Anthropic SDK) | Best reasoning for editorial decisions |
| Video assembly | FFmpeg (via fluent-ffmpeg) | Frame-accurate cuts, GPU encoding |
| Quick cuts | LosslessCut (optional) | Lossless rough cuts before pipeline |
| Timeline export | Custom FCPXML/EDL writer | DaVinci Resolve import for manual polish |
| Auto-silence removal | auto-editor (Python) | Strip dead air from mic audio |
| Social media captions | FFmpeg drawtext + ASS subtitles | Burned-in captions for TikTok/Reels |

---

## Manual Editing Fallback: DaVinci Resolve

For races that need manual creative editing (season recap, montage, special event), the pipeline exports to DaVinci Resolve Free:

- **Cross-platform:** Runs on macOS Apple Silicon natively
- **Free tier:** Handles 4K, multi-track, color grading
- **Import:** FCPXML timeline with all Claude-generated cuts pre-placed
- **Workflow:** Claude does 90% of the work → you polish the last 10% in Resolve

The `export-timeline` command generates a Resolve-compatible XML with:
- All cut points from the EDL
- Cockpit and TV-view as separate video tracks
- Audio tracks split (game audio, mic, music)
- Markers at key events (overtakes, incidents, pit stops)

---

## Camera Switching Decision Engine — Detail

This is the core intelligence. Here's how the system scores each moment:

### Scoring Model

Every second of the race gets a **TV Score** (0–100). Higher score = more reason to show TV view.

```
TV Score = Σ (signal × weight)

Signals:
  gap_ahead < 1.0s        → +40  (battle ahead)
  gap_behind < 1.0s       → +35  (battle behind)
  closest_car < 1.5 len   → +50  (side by side)
  position_changed         → +60  (overtake just happened)
  incident_count_increased → +45  (incident nearby)
  pit_entry/exit           → +55  (pit stop)
  flag != green            → +30  (caution/safety car)
  lap == 1                 → +70  (race start)
  speed_delta > -30%       → +40  (off track / spin)
  
Negative signals (stay cockpit):
  delta_best < -0.5s      → -30  (on a hot lap)
  clean_air > 3.0s        → -20  (nothing happening)
  braking_zone             → -15  (immersive cockpit moment)
```

**Hysteresis:** Once switched to TV view, hold for minimum 4 seconds to avoid jarring cuts. Once back to cockpit, hold for minimum 6 seconds (cockpit is the default state, don't cut away too quickly).

**Claude's role:** The scoring model handles 80% of decisions mechanically. Claude handles the remaining 20% — the editorial judgment calls:
- "This battle lasted 30 seconds with no pass — cut it down to 10 seconds in the highlight reel"
- "Three incidents in 2 laps — show the first from TV, skip the other two (diminishing returns)"
- "Driver set fastest lap right after a pit stop — build that narrative: show pit exit → cockpit for the flying lap"

---

## Race Condensing Engine — 20 Minutes → 5

The camera switching engine decides *which angle* to show. The condensing engine decides *what to keep at all*. A 20-minute race where 15 minutes is clean-air cruising with no commentary should become a tight 5-minute edit that only keeps the interesting parts.

### Interest Score (0–100)

Every second gets scored on a separate axis from the TV Score. This one measures "would a viewer care about this moment?"

```
Interest Score = Σ (signal × weight)

Telemetry signals:
  gap_ahead < 1.5s            → +35  (in a battle)
  gap_behind < 1.5s           → +30  (being hunted)
  position_changed             → +80  (something just happened)
  incident_count_increased     → +60  (contact or off-track)
  pit_entry/exit               → +50  (strategic moment)
  flag != green                → +40  (caution, restart coming)
  speed_delta > -20%           → +45  (spin, lockup, off-track)
  lap == 1 || lap == last      → +70  (start/finish always interesting)
  delta_best < -0.3s           → +25  (on a fast lap)

Audio signals:
  driver_mic_active            → +40  (you're talking — you think it's interesting)
  driver_mic_volume > threshold→ +20  (reacting to something even if not speaking)
  overlay_commentary_visible   → +30  (the AI commentary flagged something)
  overlay_commentary_severity  → +15 per severity level

Negative signals (boring):
  gap_ahead > 3.0s AND
    gap_behind > 3.0s          → -40  (no one near you)
  driver_mic_silent > 10s      → -25  (you're not talking)
  no_overlay_commentary > 15s  → -15  (overlay has nothing to say either)
  constant_speed ± 5%          → -10  (straight-line cruising)
  same_position > 60s          → -10  (no movement in the field)
```

### How It Works

```
Telemetry + Audio ──► Interest Score per second ──► Segment classification
                                                          │
                                                          ▼
                                               ┌─────────────────────┐
                                               │  KEEP (score > 50)  │
                                               │  MAYBE (25–50)      │
                                               │  CUT (score < 25)   │
                                               └─────────────────────┘
                                                          │
                                                          ▼
                                               Claude refines:
                                               • Merges short KEEP segments
                                               • Adds breathing room around cuts
                                               • Preserves narrative flow
                                               • Targets user's desired duration
```

**Target duration mode:** You tell the pipeline "give me 5 minutes" and it adjusts the score threshold until the total KEEP segments hit the target. Higher bar = tighter edit.

```bash
racing-desk-edit condense ./race-2026-04-15/ --target 5:00
  # Interest-scores every second
  # Classifies segments as keep/cut
  # Claude refines for narrative flow
  # FFmpeg renders condensed edit

racing-desk-edit condense ./race-2026-04-15/ --target 3:00 --social
  # Even tighter cut for social media
  # Adds captions, position badge
  # Exports 16:9 and 9:16 versions
```

### Audio Silence Detection

The mic audio track is the strongest single signal for "boring." If you're not talking, you probably don't think anything interesting is happening. The pipeline uses FFmpeg's `silencedetect` filter to find silent stretches:

```bash
ffmpeg -i mic-audio.aac -af silencedetect=noise=-30dB:d=5 -f null -
```

This produces timestamps of every silence gap longer than 5 seconds. These map directly to low-interest segments. Combined with telemetry signals, it's a reliable "boring detector."

### The Overlay Commentary Signal

Your overlay already has AI commentary (`CommentaryVisible`, `CommentaryText`, `CommentaryTopicId`, `CommentarySeverity`). When the commentary system fires, something noteworthy happened. When it's quiet, nothing did. This is essentially a second AI opinion on what's interesting, already running during the race.

The telemetry sidecar captures these fields, so the condensing engine gets them for free:

```jsonl
{"t":125.4,"commentary":true,"topic":"position_gained","severity":2,"text":"Great move into T4..."}
{"t":180.0,"commentary":false}
```

### Claude's Role in Condensing

The scoring engine handles the mechanical cut/keep decisions. Claude handles the editorial polish:

- **Narrative continuity:** Don't cut between two battles that are part of the same multi-lap fight. Keep the buildup even if individual seconds score low.
- **Pacing:** A 5-minute edit shouldn't be all action with no breathing room. Keep 2–3 second transitions between intense segments.
- **Context preservation:** If you gained P7 → P5 across two separate battles 3 minutes apart, the audience needs to understand the position changed — add a brief title card or keep a few seconds of the gap closing.
- **Duration targeting:** Adjust the interest threshold to hit the target length, favoring trimming the longest boring stretches first.

### Example: 20-Minute Race → 5-Minute Edit

```
Original race timeline (20:00):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Start  Battle  Cruise   Pit   Cruise   Battle  Cruise  Finish
  0:00   0:45    3:00     5:30  6:30     12:00   14:00   19:00
  ████   ████    ░░░░░░   ████  ░░░░░░   ████    ░░░░░░  █████

Condensed edit (5:00):
━━━━━━━━━━━━━━━━━━━━━━━━

  Start → Battle → [title: "Lap 4 — Pit Window"] → Pit → Battle → Finish
  0:00    0:45     1:30                              1:35   2:30    4:00
  ████    ████     ▓▓                                ████   ████    █████

  ████ = kept (high interest)
  ░░░░ = cut (low interest)
  ▓▓   = Claude-added context bridge
```

The cruising segments are gone entirely. Claude adds a brief context bridge ("Lap 4 — Pit Window") so the viewer understands time has passed. The result is a tight, watchable edit that only shows the moments that matter.

---

## Project Structure

```
racing-desk-edit/
├── package.json
├── bin/
│   └── racing-desk-edit.js          # CLI entry point
├── src/
│   ├── ingest/
│   │   ├── parse-telemetry.js   # JSONL → event stream
│   │   ├── sync-sources.js      # Align cockpit + TV timestamps
│   │   └── detect-events.js     # Telemetry → racing events
│   ├── analyze/
│   │   ├── scoring-engine.js    # TV Score calculator
│   │   ├── interest-engine.js   # Interest Score calculator (keep/cut)
│   │   ├── silence-detect.js    # FFmpeg silencedetect wrapper
│   │   ├── condenser.js         # Target-duration segment selection
│   │   ├── claude-director.js   # Claude API integration
│   │   ├── edl-generator.js     # Merge scores + Claude → EDL
│   │   └── prompts/
│   │       ├── broadcast-director.md
│   │       ├── highlight-reel.md
│   │       ├── condense-race.md
│   │       └── social-clips.md
│   ├── render/
│   │   ├── ffmpeg-assembly.js   # EDL → FFmpeg commands
│   │   ├── transitions.js       # Cross-dissolve, wipe timing
│   │   ├── overlays.js          # Position badge, track name
│   │   └── social-export.js     # 9:16 crop + captions
│   ├── export/
│   │   ├── fcpxml-writer.js     # DaVinci Resolve timeline
│   │   └── edl-writer.js        # Standard EDL format
│   └── utils/
│       ├── ffmpeg.js            # FFmpeg wrapper + GPU detect
│       └── time.js              # Timecode utilities
├── prompts/                     # Claude prompt templates
└── tests/
```

---

## Implementation Phases

### Phase 1 — Telemetry Recording + Event Detection (Week 1–2)

Build the telemetry sidecar writer into the overlay recorder (ties into OBS replacement Phase 1). Build the `ingest` and `detect-events` modules. Output: a clean event stream from any recorded race.

### Phase 2 — Scoring Engine + Basic Assembly (Week 3–4)

Build the TV Score calculator and FFmpeg assembly pipeline. No Claude yet — pure rule-based camera switching. This alone solves 80% of the camera switching problem.

### Phase 3 — Claude Integration + Race Condensing (Week 5–7)

Add Claude API calls for editorial refinement. Build the prompt templates. Add highlight reel generation. Build the interest scoring engine and audio silence detection. The `condense` command — turning a 20-minute race into a 5-minute edit — lands here. This is the phase where the pipeline goes from "useful" to "I can't go back to manual editing."

### Phase 4 — Social Media Export + DaVinci Export (Week 8–9)

9:16 crop, auto-captions, burned-in overlays for social clips. FCPXML export for manual polish in DaVinci Resolve. Context bridge title cards for condensed edits.

### Phase 5 — Real-Time Replay Director (Week 10–11)

The automated replay director (see OBS replacement plan Phase 5) sends keyboard commands to iRacing's replay system, jumping to each TV-view moment and recording it via NVENC. After a race, you hit `Ctrl+Shift+P` and walk away — the overlay handles the replay pass, records the TV-view footage, and hands the editing pipeline everything it needs. This is the payoff for the entire two-project pipeline: race → hotkey → walk away → come back to a finished edit.

---

## Cost Estimate

| Item | Cost |
|------|------|
| DaVinci Resolve Free | $0 |
| LosslessCut | $0 (or $15 App Store) |
| auto-editor | $0 (open source) |
| FFmpeg | $0 (open source) |
| Claude API (per race edit) | ~$0.05–0.15 per race (event stream is small, ~2K tokens in, ~4K out) |
| **Total monthly** (10 races) | **~$1.50** |

Compare to: Premiere Pro at $23/month.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Replay keyboard automation timing** | Jumps land on wrong frame, camera doesn't switch cleanly | Add settle time (500ms pause after each jump before recording starts); verify camera state via screenshot sampling; manual fallback always available |
| **Claude API latency** for analysis | 10–30 second wait per race | Async — kick off analysis, render preview while waiting; event stream is small so it's fast |
| **Telemetry sync drift** between cockpit and TV recordings | Cuts land on wrong frames | Use lap number + lap time as sync anchors (not wall clock); sub-frame accuracy |
| **Claude makes bad editorial decisions** | Awkward cuts in final video | Scoring engine handles mechanics (no AI needed); Claude only handles subjective calls. Preview mode lets you review before final render |
| **Condensing removes important context** | Viewer confused by jumps in time | Claude adds context bridge title cards; interest engine preserves narrative buildup before key moments |

---

## Summary: The Full Workflow

After everything is built, here's what a race night looks like:

```
1. Launch iRacing + overlay as usual
2. Hit Ctrl+Shift+V — recording starts (NVENC, zero performance hit)
3. Race. The overlay records cockpit video + telemetry sidecar + mic audio.
4. Race ends. Hit Ctrl+Shift+P — automated replay director takes over.
5. Walk away. The overlay:
   - Analyzes telemetry → identifies TV-view moments
   - Opens iRacing replay → switches to broadcast camera
   - Jumps to each moment → records TV-view footage via NVENC
   - Finishes in ~4 minutes for a 20-minute race
6. Transfer files to Mac (LAN server, network share, or USB)
7. Run: racing-desk-edit condense ./race-tonight/ --target 5:00
   - Scores every second for interest (telemetry + mic audio + overlay commentary)
   - Claude generates camera switching decisions + narrative polish
   - FFmpeg assembles the final edit with TV-view cuts
   - Outputs: condensed 5-minute race edit + 60-second social clips
8. Watch. Adjust. Or export to DaVinci Resolve for manual polish.
```

A 20-minute race becomes a 5-minute broadcast-quality edit with one hotkey during the race, one hotkey after, and one CLI command on the Mac. The camera switching problem — your biggest pain point — gets solved by telemetry data you're already collecting. Claude turns that data into broadcast-director-level decisions. And the boring parts are gone.
