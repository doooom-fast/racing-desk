# Getting Started with Recording

A step-by-step guide to recording your first race with RaceCor's built-in recording pipeline and producing an edited highlight from it.

---

## Prerequisites

- RaceCor overlay installed and running
- FFmpeg on your system PATH (or `ffmpeg-static` in the overlay's node_modules)
- iRacing (or any supported sim) running
- For MP4 output: NVIDIA, Intel, or AMD GPU recommended (CPU fallback available)
- For AI-assisted editing: the `claude` CLI tool installed, or an `ANTHROPIC_API_KEY` set

---

## Step 1: Configure Recording Settings

Open the overlay settings with **Ctrl+Shift+S** and go to the **Recording** tab.

**Sources** — Select your display source. If you want system audio in the recording, select your virtual audio cable device (e.g., VB-Audio Cable Output). Optionally select a microphone and webcam.

**Output** — Choose your output format:

- **MP4** (recommended) — records as WebM, auto-transcodes to MP4 when recording stops. The transcode uses your GPU's hardware encoder (NVENC on NVIDIA, QSV on Intel, AMF on AMD) so it's fast and free.
- **WebM** — instant output, no transcode step. Larger files, less compatible with editing tools.

The **Detected Encoder** field shows which hardware encoder was found (e.g., `h264_nvenc`). You can override this manually, but auto usually picks the fastest option.

Enable **Delete WebM source** if you chose MP4 — this cleans up the intermediate file after a successful transcode.

---

## Step 2: Enable Smart Recording (Optional)

In the **Smart Recording** section:

- **Auto-Record** — When enabled, recording starts automatically when your car exits the pit lane and stops when you pit again or the race ends. You never need to remember to hit record.
- **Split on Pit** — When enabled alongside auto-record, each stint gets its own file. Leave it off for one continuous recording per session.

With both enabled, you'll get a separate video + telemetry sidecar for each stint, each cleanly trimmed to on-track time only.

---

## Step 3: Enable Replay Buffer (Optional)

The replay buffer continuously captures the last 30–120 seconds in memory. When something amazing happens, hit **Ctrl+Shift+B** to save it as a clip — no full recording needed.

- Toggle **Replay Buffer** on in settings
- Choose your buffer duration (60s is a good starting point)
- The buffer starts automatically when a game is detected and pauses when idle

Memory usage scales linearly with duration: 60 seconds ≈ 120–300 MB, 120 seconds ≈ 240–600 MB.

---

## Step 4: Record a Race

**With auto-record:** Just drive. Recording starts when you leave the pits and stops when you pit or the race ends.

**Without auto-record:** Start recording manually before the green flag. Stop it after the race.

While recording, you'll see a red indicator in the overlay with a duration timer. Behind the scenes, the **telemetry sidecar** is writing simultaneously — one JSON line per frame containing position, gaps, speed, inputs, G-forces, incidents, flags, pit status, and fuel data. Event markers (overtakes, incidents, pit stops) are auto-detected and embedded in the sidecar.

When recording stops, the transcode kicks in if you chose MP4 output. You'll see a progress indicator.

Your session directory now contains:

```
my-race/
├── recording-2026-04-15_20-30-00.mp4          # your video
└── recording-2026-04-15_20-30-00.telemetry.jsonl  # frame-synced telemetry + markers
```

---

## Step 5: Run the Replay Director (Optional)

The Replay Director automatically records TV-view footage of your race's best moments by driving iRacing's replay system. This gives you a second camera angle for the editing pipeline.

1. Make sure iRacing's replay is available (don't exit the session yet)
2. Press **Ctrl+Shift+P** or click **Start Replay Director** in settings
3. The director reads your sidecar, identifies TV-worthy moments (overtakes, incidents, pit stops), then automates iRacing's replay: switching to the broadcast camera, fast-forwarding between moments, and recording everything
4. A progress overlay shows which moment is being recorded — you can cancel at any time

The output is a single MP4 of TV-view footage. Copy it into your session directory alongside the cockpit recording:

```
my-race/
├── recording-2026-04-15_20-30-00.mp4
├── recording-2026-04-15_20-30-00.telemetry.jsonl
└── replay-director-2026-04-15_20-45-00.mp4     # TV-view footage
```

---

## Step 6: Edit with racecor-edit

Install the CLI tool (from the monorepo root):

```bash
cd racecor-edit
npm install
```

### Ingest

Parse the telemetry sidecar, detect racing events, and build a session manifest:

```bash
node bin/racecor-edit.js ingest ./my-race/
```

This reads the `.telemetry.jsonl`, classifies video files as cockpit or TV-view, probes durations, runs event detection, and writes `session.json`.

### Analyze

Score every second of footage and generate an edit decision list:

```bash
node bin/racecor-edit.js analyze ./my-race/
```

The analyzer computes two scores per second:

- **TV Score (0–100)** — how strongly to show TV camera vs. cockpit (battles, overtakes = high; clean air, hot laps = low)
- **Interest Score (0–100)** — how interesting the moment is to a viewer (position changes = high; long gaps with no action = low)

If `claude` is on your PATH or `ANTHROPIC_API_KEY` is set, the tool sends the scores and event stream to Claude for editorial refinement. Otherwise it uses the mechanical scores directly — still produces good edits.

Output: `edit-decisions.json` with cut points, camera sources, and a highlight reel.

### Preview

Render a fast low-res draft with burn-in timecodes to check the edit:

```bash
node bin/racecor-edit.js preview ./my-race/
```

### Render

Assemble the full-resolution final edit:

```bash
node bin/racecor-edit.js render ./my-race/
```

### Condense

Produce a condensed highlight at a target duration:

```bash
node bin/racecor-edit.js condense ./my-race/ --target 5:00
```

The condenser uses Interest Scores and silence detection to decide what to keep and what to cut, adjusting the threshold iteratively until it hits the target. Claude adds context bridges (title cards like "Lap 4 — Pit Window") for cut sections when available.

### Social Clips

Generate social media clips with optional 9:16 vertical exports:

```bash
node bin/racecor-edit.js clips ./my-race/ --social
```

---

## Claude Integration

The `analyze` and `condense` commands optionally use Claude for editorial refinement. Two modes are supported:

| Mode | How | When |
|------|-----|------|
| **CLI** (default) | Pipes prompt to the `claude` command-line tool via stdin | `claude` is on PATH |
| **SDK** | Uses `@anthropic-ai/sdk` with API key | `ANTHROPIC_API_KEY` is set |

Override with `--claude-mode cli` or `--claude-mode sdk`, or set `RACECOR_CLAUDE_MODE` env var.

If neither is available, the tools still work — you just get the mechanical scoring engine output without AI refinement. The scoring engine alone produces solid results; Claude adds narrative intelligence on top (like recognizing that a battle that spans three laps should be kept intact rather than chopped into segments).

---

## Hotkey Quick Reference

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+S | Open settings (Recording tab) |
| Ctrl+Shift+B | Save replay buffer clip |
| Ctrl+Shift+P | Start/cancel Replay Director |
| Ctrl+Shift+H | Hide/show overlay |
| Ctrl+Shift+Q | Quit |

---

## Troubleshooting

**No encoder detected** — Make sure FFmpeg is on your PATH. Run `ffmpeg -encoders | grep h264` to verify. The overlay tries NVENC, QSV, AMF, then libx264 in order.

**Auto-record not triggering** — Check that Auto-Record is enabled in settings. The trigger watches pit lane telemetry, so it only works during race sessions (not practice/qualifying unless you pit).

**Replay Director not controlling iRacing** — The director sends keystrokes via PowerShell. Make sure iRacing's replay window is in focus. The director switches to it automatically, but if another window grabs focus mid-sequence, the keystrokes go to the wrong place.

**Claude not available** — Run `which claude` (macOS/Linux) or `where claude` (Windows) to check if the CLI is installed. For SDK mode, verify `ANTHROPIC_API_KEY` is set in your environment.

**Large telemetry sidecars** — At 30fps, a 45-minute race produces ~81,000 lines of JSONL (~15–25 MB). This is normal and the ingest pipeline handles it efficiently.
