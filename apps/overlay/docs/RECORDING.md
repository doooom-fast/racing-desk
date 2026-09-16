# RaceCor Recording Pipeline

**Status:** Implemented  
**Date:** April 15, 2026

---

## Overview

Built-in screen recording with GPU-accelerated transcoding, system audio mixing, facecam compositing, telemetry-aware auto-start/stop, a rolling replay buffer, and an automated iRacing replay director. Replaces OBS Studio entirely for sim racing content capture.

The recording pipeline lives inside the Electron overlay. It captures the full display (game + overlay composited), writes frame-synced telemetry alongside the video, and can drive iRacing's replay system for automated TV-view recordings.

See also: [obs-replacement-plan.md](obs-replacement-plan.md) (original design), [GETTING_STARTED_RECORDING.md](GETTING_STARTED_RECORDING.md) (setup guide), [RACECOR_EDIT.md](RACECOR_EDIT.md) (post-production CLI).

---

## Modules

| Module | Process | Purpose |
|--------|---------|---------|
| `recorder.js` | Renderer | Screen + audio + facecam capture via MediaRecorder |
| `recorder-ui.js` | Renderer | Recording settings panel, device selection, status indicators |
| `ffmpeg-encoder.js` | Main | GPU-accelerated WebM → MP4 transcode |
| `telemetry-sidecar.js` | Renderer | Frame-synced JSONL telemetry log alongside video |
| `auto-record.js` | Renderer | Telemetry-aware recording triggers (pit exit/entry, session end) |
| `replay-buffer.js` | Renderer | Independent rolling ring buffer with on-demand save |
| `keyboard-sender.js` | Main | PowerShell + user32.dll keybd_event for iRacing control |
| `replay-director.js` | Main | Automated iRacing replay recording sequencer |
| `replay-director-ui.js` | Renderer | Director progress overlay (status, bar, cancel) |

---

## Phase 1: Screen Capture & FFmpeg Transcode

Electron's `desktopCapturer` grabs the entire display and pipes it through a MediaRecorder at up to 12 Mbps. Raw output is WebM/VP8. After recording stops, FFmpeg transcodes to MP4 with a hardware encoder priority chain:

1. **NVENC** (NVIDIA) — uses the dedicated encoder chip, zero game performance cost
2. **QSV** (Intel Quick Sync)
3. **AMF** (AMD)
4. **libx264** (software fallback)

The encoder is auto-detected at startup but can be manually overridden in settings.

Chunks are streamed from the renderer to the main process via IPC for file I/O — the renderer never touches the filesystem directly.

## Phase 2: System Audio, Mic & Facecam

Three additional sources mixed into the recording:

- **System audio** — captured via a virtual audio cable (VB-Audio or similar) that appears as a microphone input to Electron
- **Microphone** — second audio device, separate from system audio
- **Facecam** — composited via offscreen canvas picture-in-picture, drawn into a corner of the capture canvas each frame

The Web Audio API mixes system audio and mic into a single audio track attached to the MediaRecorder.

## Phase 3: Output Settings UI

Full settings panel in the overlay's Recording tab:

- **Output format** — MP4 (auto-transcodes after recording) or WebM (instant, no transcode)
- **Encoder override** — auto-detect or manual selection (h264_nvenc, h264_qsv, h264_amf, libx264)
- **Delete source** — remove intermediate .webm after successful MP4 transcode
- **Detected encoder** — shows which GPU encoder was found at startup
- **Smart Recording toggles** — auto-record and pit-split (see Phase 4)
- **Replay Buffer toggles** — enable/disable and buffer duration (see Phase 4)

## Phase 4: Smart Recording & Telemetry Sidecar

### Telemetry Sidecar

During recording, `telemetry-sidecar.js` writes one JSON line per poll frame (~30fps) to a `.telemetry.jsonl` file alongside the video. Each line contains:

- Position, gap ahead, gap behind
- Speed (mph), lap number, current sector
- Steering angle, throttle, brake inputs
- Lateral and longitudinal G-forces
- Incident count, flag state, pit lane status
- Fuel level and maximum fuel capacity
- Proximity to nearest car

The sidecar auto-detects event markers as they happen: position changes, new incidents, lap completions, and pit entry/exit. All markers are collected and written as a summary line when recording stops.

Writes are batched — flushed every 30 frames (~1 second) using fire-and-forget IPC (`ipcMain.on` instead of `ipcMain.handle`) for zero renderer-thread blocking.

### Auto-Record

`auto-record.js` watches telemetry for session state transitions and pit lane changes:

- Starts recording when the car exits the pit lane
- Stops recording when the car enters the pit lane (optional per-stint splitting)
- Stops recording when the session ends (5-second delay for cooldown lap start)
- 30-frame debounce prevents rapid on/off from pit lane jitter

Users enable auto-record and pit-split independently in settings. Dispatches `auto-record-event` CustomEvents that the UI picks up for flash notifications.

### Replay Buffer

`replay-buffer.js` runs an independent MediaRecorder at 8 Mbps, keeping a rolling ring buffer of the last 30–120 seconds in memory. Ctrl+Shift+B saves the buffer as a clip.

- Auto-starts when a game is detected (checks `document.body.classList.contains('idle-state')`)
- Pauses when idle, resumes when game activity returns
- Memory usage: ~2–5 MB/s × buffer duration (60s ≈ 120–300 MB, 120s ≈ 240–600 MB)
- Saved clips go through the same transcode pipeline as regular recordings

## Phase 5: Automated Replay Director

After a race, the Replay Director reads the telemetry sidecar to find TV-worthy moments, then drives iRacing's replay system to record broadcast-camera footage of each one — zero manual scrubbing.

### Components

**keyboard-sender.js** — Sends native keystrokes to iRacing via PowerShell + user32.dll `keybd_event`. Uses `-EncodedCommand` with Base64 encoding to eliminate all quoting issues. Maps virtual key codes for all iRacing numpad controls plus modifiers (Shift, Ctrl).

**replay-director.js** — Main-process sequencing engine:

1. Parses the sidecar `.telemetry.jsonl` file
2. Extracts TV-view moments from markers (overtakes priority 3, incidents 2, pit stops 1)
3. Merges moments within 5 seconds of each other
4. Executes the replay automation sequence

**replay-director-ui.js** — Renderer-side progress overlay positioned center-bottom, showing status text, a progress bar, and a cancel button.

### Replay Sequence

1. Enter iRacing replay mode
2. Switch to TV/broadcast camera (3× Ctrl+F12)
3. Start one continuous recording
4. For each moment: fast-forward (hold Shift+Numpad6) → settle 1.5s → play at 1× → pause → next
5. Stop recording, notify renderer

The output is a single MP4 of TV-view footage covering all the interesting moments, ready for the editing pipeline.

---

## IPC Channels

| Channel | Direction | Type | Notes |
|---------|-----------|------|-------|
| `sidecar-start` | Renderer → Main | handle | Opens JSONL write stream |
| `sidecar-write` | Renderer → Main | on | Fire-and-forget for 30fps performance |
| `sidecar-stop` | Renderer → Main | handle | Flushes and closes stream |
| `save-replay-buffer` | Renderer → Main | handle | Saves buffer blob + optional transcode |
| `start-replay-director` | Renderer → Main | handle | Begins automated replay sequence |
| `cancel-replay-director` | Renderer → Main | handle | Stops director mid-sequence |
| `get-replay-director-state` | Renderer → Main | handle | Returns running/idle state |
| `parse-sidecar-moments` | Renderer → Main | handle | Parses sidecar without running director |
| `replay-director-progress` | Main → Renderer | send | Progress updates during director run |
| `replay-director-record` | Main → Renderer | send | Start/stop recording commands |

---

## Hotkeys

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+B | Save replay buffer (last 30–120s) |
| Ctrl+Shift+P | Start / cancel Replay Director |
