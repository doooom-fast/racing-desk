# racecor-edit — AI Race Editing Pipeline

**Status:** Implemented  
**Location:** `racecor-edit/` (monorepo root)  
**Date:** April 15, 2026

---

## Overview

Standalone Node.js ESM command-line tool that replaces the manual video editing workflow. Takes raw recordings from the RaceCor overlay — cockpit video, TV-view video, and `.telemetry.jsonl` sidecar — and produces broadcast-quality race edits, condensed highlights, and social media clips.

Requires Node ≥ 20 and FFmpeg on PATH. Claude integration is optional.

See also: [premiere-replacement-plan.md](premiere-replacement-plan.md) (original design), [GETTING_STARTED_RECORDING.md](GETTING_STARTED_RECORDING.md) (end-to-end walkthrough).

---

## Installation

```bash
cd racecor-edit
npm install
```

The Anthropic SDK (`@anthropic-ai/sdk`) is in `optionalDependencies` — it installs if possible but the tool works without it via the `claude` CLI.

---

## Commands

```
racecor-edit <command> <session-dir> [options]
```

| Command | Description |
|---------|-------------|
| `ingest <dir>` | Parse telemetry sidecar, detect racing events, write `session.json` |
| `analyze <dir>` | Score footage + Claude refinement → `edit-decisions.json` |
| `preview <dir>` | Render low-res 480p preview with burn-in timecodes |
| `render <dir>` | Assemble full-resolution final edit |
| `condense <dir>` | Smart-cut to a target duration |
| `clips <dir>` | Generate social media clips (16:9 + optional 9:16) |

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | auto-named in session dir |
| `-t, --target <duration>` | Target duration for condense (e.g., `5:00`) | `5:00` |
| `-q, --quality <level>` | `draft` or `final` | `final` |
| `-r, --resolution <px>` | `480`, `720`, `1080`, `4k` | `1080` |
| `-s, --social` | Include 9:16 vertical exports | `false` |
| `--claude-mode <mode>` | Force Claude integration: `cli` or `sdk` | auto-detect |
| `-v, --verbose` | Show full error traces | `false` |

### Examples

```bash
# Full pipeline
racecor-edit ingest ./race-2026-04-15/
racecor-edit analyze ./race-2026-04-15/
racecor-edit render ./race-2026-04-15/ -o final.mp4

# Quick preview
racecor-edit preview ./race-2026-04-15/

# 5-minute condensed highlight with social vertical
racecor-edit condense ./race-2026-04-15/ --target 5:00 --social

# Social clips only
racecor-edit clips ./race-2026-04-15/ --social
```

---

## Pipeline Architecture

```
ingest → analyze → render
           │
           ├── scoring-engine (TV Score + Interest Score per second)
           ├── camera hysteresis (mechanical camera segments)
           ├── silence detection (FFmpeg silencedetect)
           ├── claude-director (optional AI editorial refinement)
           └── edl-generator → edit-decisions.json
```

The `condense` command runs a modified version of this pipeline that targets a specific output duration, adjusting the interest threshold iteratively until the kept segments fit.

---

## Scoring System

Two parallel scores computed for every second of footage:

### TV Score (0–100)

How strongly the footage should be shown from a TV/broadcast camera vs. the cockpit.

| Signal | Weight | Notes |
|--------|--------|-------|
| Gap ahead < 0.8s | +40 | In a battle |
| Gap ahead < 1.5s | +25 | Developing battle |
| Gap behind < 0.8s | +35 | Being attacked |
| Gap behind < 1.5s | +20 | Under pressure |
| Side by side | +50 | < 1.5 car lengths |
| Position changed | +60 | Overtake happened |
| Incident | +45 | Contact nearby |
| Pit entry/exit | +55 | Strategy moment |
| Flag (not green) | +30 | Caution / safety car |
| Lap one | +70 | Race start |
| Speed drop | +40 | Off track or contact |
| Hot lap | -30 | Delta best < -0.5s (stay cockpit) |
| Clean air | -20 | Gaps > 3.0s both sides |
| Braking zone | -15 | Heavy braking (immersive in cockpit) |

### Interest Score (0–100)

How interesting the moment is to a viewer. Drives keep/cut decisions in condensing.

| Signal | Weight | Notes |
|--------|--------|-------|
| Position changed | +80 | Something just happened |
| Start or finish | +70 | Lap 1 or last lap |
| Incident | +60 | Contact, off-track |
| Pit stop | +50 | Strategic moment |
| Speed drop | +45 | Spin, lockup |
| Gap close (< 1.5s) | +35 | Battle developing |
| Gap pressure (< 1.5s behind) | +30 | Being hunted |
| Flag (not green) | +40 | Caution restart coming |
| Fast lap | +25 | Personal best |
| Clean air | -40 | Nobody nearby |
| No position change > 60s | -10 | Stagnant |

### Camera Hysteresis

Raw scores are converted to stable camera segments with minimum hold times: 4 seconds in TV view, 6 seconds in cockpit. This prevents the rapid switching that makes broadcasts unwatchable.

---

## Event Detection

The `ingest` command scans the telemetry sidecar frame-by-frame and identifies:

| Event | Trigger |
|-------|---------|
| `race_start` | First frame of session |
| `position_change` | Position differs from previous frame |
| `close_battle` | Gap < 1.5s to adjacent car, sustained > 2s, merged within 5s |
| `incident` | Incident counter increases |
| `pit_entry` / `pit_exit` | Pit lane status transitions |
| `flag_change` | Flag state changes |
| `speed_drop` | Speed drops > 30% in one frame |
| `new_lap` / `fast_lap` | Lap completed; personal best set |
| `race_end` | Session end detected |

---

## Claude Integration

Two modes, auto-detected:

| Mode | Trigger | How it works |
|------|---------|--------------|
| **CLI** | `claude` on PATH | Pipes prompt via stdin to `claude --print --output-format text --max-turns 1` |
| **SDK** | `ANTHROPIC_API_KEY` set | Uses `@anthropic-ai/sdk` with `claude-sonnet-4-20250514` |

Detection priority: `RACECOR_CLAUDE_MODE` env var → `ANTHROPIC_API_KEY` → `claude` CLI → mechanical fallback.

Claude receives two types of prompts:

- **Broadcast Director** (`src/analyze/prompts/broadcast-director.md`) — refines camera switching decisions, considering narrative arcs and battle continuity
- **Condense Race** (`src/analyze/prompts/condense-race.md`) — refines condensing cuts, adds context bridges for skipped sections

Both prompts include the race summary, event stream, computed scores, and a JSON schema for the expected response. Claude returns structured JSON that replaces or augments the mechanical EDL.

If Claude is unavailable, the mechanical scoring engine output is used directly. It produces solid results — Claude adds the layer of narrative intelligence (e.g., keeping a multi-lap battle intact rather than cutting between segments).

---

## Session Directory Format

After `ingest`, a session directory looks like:

```
my-race/
├── recording-2026-04-15_20-30-00.mp4              # cockpit video
├── recording-2026-04-15_20-30-00.telemetry.jsonl   # frame-synced telemetry
├── replay-director-2026-04-15_20-45-00.mp4         # TV-view video (optional)
├── session.json                                     # ingest output
└── edit-decisions.json                              # analyze output
```

### Telemetry Sidecar Format

Each line is a JSON object with these fields:

```json
{
  "i": 1234,
  "t": 41133,
  "pos": 3,
  "gapAhead": 1.2,
  "gapBehind": 0.8,
  "speed": 142.5,
  "lap": 12,
  "sector": 2,
  "steer": 0.15,
  "throttle": 1.0,
  "brake": 0.0,
  "gLat": 0.8,
  "gLon": -0.3,
  "incidents": 2,
  "flag": "green",
  "inPit": false,
  "fuel": 14.2,
  "maxFuel": 30.0,
  "proximity": 1.1
}
```

The final line is a summary with all event markers collected during the recording.

---

## Modules

| Module | Purpose |
|--------|---------|
| `bin/racecor-edit.js` | CLI entry point, command routing, arg parsing |
| `src/ingest/parse-telemetry.js` | JSONL parsing, video classification, `session.json` generation |
| `src/ingest/detect-events.js` | Frame-by-frame event detection |
| `src/analyze/scoring-engine.js` | TV Score + Interest Score with configurable weights |
| `src/analyze/claude-director.js` | Dual-mode Claude integration, prompt template loading |
| `src/analyze/edl-generator.js` | Scoring → Claude refinement → `edit-decisions.json` |
| `src/analyze/condenser.js` | Interest-based condensing with target duration |
| `src/analyze/silence-detect.js` | FFmpeg `silencedetect` wrapper |
| `src/render/ffmpeg-assembly.js` | Segment extraction, concat, encoder selection, 9:16 crop |
| `src/utils/ffmpeg.js` | FFmpeg path detection, encoder probing, progress parsing |
| `src/utils/time.js` | Duration parsing (`5:00` → 300) and formatting (300 → `5:00`) |
| `src/analyze/prompts/broadcast-director.md` | Prompt template for camera switching refinement |
| `src/analyze/prompts/condense-race.md` | Prompt template for condensing refinement |
