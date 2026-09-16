# RaceCor Recorder — Replacing OBS with Built-In Capture

**Status:** Implemented  
**Author:** kevin  
**Date:** April 15, 2026  
**Implementation docs:** [RECORDING.md](RECORDING.md), [GETTING_STARTED_RECORDING.md](GETTING_STARTED_RECORDING.md)

---

## Goal

Eliminate OBS from the sim racing recording workflow by building capture and recording directly into the RaceCor Electron overlay. The overlay already runs as a transparent always-on-top window on the game — it's the ideal place to own the recording pipeline.

## Why This Makes Sense

The overlay already has several pieces of the puzzle in place:

- **Electron 33+** ships with `desktopCapturer` API and full MediaRecorder support
- **Ambient capture system** (`ambient-capture.js`) already does screen region sampling at ~15fps — proving the capture path works
- **Always-on-top window** with GPU flags (`enable-gpu-rasterization`, `enable-zero-copy`) already optimized for compositing
- **Settings system** (`settings.js` + IPC bridge) ready to host recording preferences
- **LAN server** (`remote-server.js` on port 9090) could serve recorded clips to the Mac for editing

**Hardware: RTX 4090** — NVENC's dedicated encoder chip is separate from the CUDA cores. Recording costs zero game performance. The 4090's 8th-gen NVENC supports H.264 and HEVC at up to 8K, with AV1 encoding for future-proofing. This is the same encoder OBS uses — we just drive it directly via FFmpeg instead of through OBS's UI.

What OBS does that we need to replicate: capture a game window, composite a facecam overlay, mix audio sources, and encode to a file. What OBS does that we *don't* need: scene switching, streaming protocols, browser sources, plugin ecosystem.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  main.js (Electron main process)                        │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Capture      │  │ Audio Mixer  │  │ Encoder       │  │
│  │ Manager      │  │              │  │ Pipeline      │  │
│  │              │  │ Game audio   │  │               │  │
│  │ desktopCapt. │  │ (WASAPI)     │  │ MediaRecorder │  │
│  │ → MediaStream│  │ + Mic        │  │ OR            │  │
│  │              │  │ (getUserMedia)│  │ FFmpeg child  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         └────────┬────────┘                   │          │
│                  ▼                            │          │
│          Combined MediaStream ───────────────►│          │
│                                               ▼          │
│                                    .webm / .mp4 file     │
│                                    in recording dir      │
└─────────────────────────────────────────────────────────┘
```

### Phase 1 — Basic Screen Recording (MVP)

**What:** Record the full display (game + overlay composited) to a local `.webm` file using Electron's built-in APIs. No external dependencies.

**New files:**

| File | Purpose |
|------|---------|
| `modules/js/recorder.js` | Renderer-side recording module |
| `modules/js/recorder-ui.js` | Recording indicator, controls |
| `modules/styles/recorder.css` | Recording UI styles |

**Implementation:**

1. **Capture the screen** — `desktopCapturer.getSources({ types: ['screen'] })` returns a source ID. Pass it to `navigator.mediaDevices.getUserMedia()` with video constraints (1920×1080, 60fps target). This captures the entire display including the overlay itself.

2. **Add microphone** — `navigator.mediaDevices.getUserMedia({ audio: true })` for mic input. Combine tracks using a `MediaStream` constructor.

3. **Record** — Feed the combined stream into `MediaRecorder` with `mimeType: 'video/webm;codecs=vp9'` (or `h264` if available). Write chunks to disk via IPC as `Blob` → `ArrayBuffer` → `Buffer` → `fs.writeFile`.

4. **Controls** — Start/stop via new hotkey (`Ctrl+Shift+V`). Red recording dot in overlay corner. Timer display.

5. **Settings** — Recording directory, quality preset (720p/1080p/native), codec preference. Stored in existing `overlay-settings.json`.

**IPC additions to `preload.js`:**

```js
// New context bridge methods
k10.startRecording(options)   // → main process creates write stream
k10.stopRecording()           // → main process finalizes file
k10.writeRecordingChunk(buf)  // → main process appends to file
k10.getRecordingState()       // → { recording: bool, duration, fileSize }
k10.onRecordingError(cb)      // → error forwarding
```

**Estimated effort:** 2–3 days for a working prototype.

**Limitations of Phase 1:**
- No system audio (game sound) — only mic
- WebM container (not MP4) — needs remux for some editors
- Full screen capture, not game-window-specific
- No facecam compositing

---

### Phase 2 — System Audio + Facecam

**What:** Add game audio capture and picture-in-picture webcam.

**System audio (the hard part):**

Windows doesn't expose system audio through the browser's `getUserMedia`. Options:

| Approach | Pros | Cons |
|----------|------|------|
| **Virtual audio cable** (VB-Audio, etc.) | Zero code changes — user routes game audio to virtual device, overlay captures it as a "mic" | Requires user setup, third-party install |
| **WASAPI loopback via native module** | Transparent to user, captures any audio playing | Requires building/shipping a native Node addon (`node-gyp`), platform-specific |
| **Stereo Mix** (Windows built-in) | No install needed if hardware supports it | Many sound cards don't expose it, quality varies |

**Recommendation:** Start with virtual audio cable as a documented setup step (it's what most streamers already have). Build WASAPI loopback as a stretch goal using `node-addon-api`.

**Facecam compositing:**

Open a second `getUserMedia` stream for the webcam. In the renderer, draw both streams to an offscreen `<canvas>` at the target resolution:

```
┌──────────────────────────────┐
│        Game capture          │
│                              │
│                  ┌──────────┐│
│                  │  Webcam  ││
│                  │  (PiP)   ││
│                  └──────────┘│
└──────────────────────────────┘
         ↓ canvas.captureStream()
     Combined MediaStream → MediaRecorder
```

The `<canvas>` approach lets us control webcam position, size, border, and even apply the existing WebGL effects (glare, bloom) to the facecam.

**Estimated effort:** 1 week (facecam straightforward, audio capture depends on native module decision).

---

### Phase 3 — FFmpeg Encoder Pipeline

**What:** Replace MediaRecorder with FFmpeg for GPU-accelerated encoding, MP4 output, and pro-level quality control.

**Why FFmpeg over MediaRecorder:**
- NVENC/QSV/AMF hardware encoding (10× faster, near-zero CPU)
- Native MP4/H.264 output (no remuxing)
- Configurable bitrate, CRF, keyframe interval
- Separate audio/video tracks for editing flexibility

**Bundling approach:**

Use `ffmpeg-static-electron` (pre-built binaries, ~40MB) or the more actively maintained `@ffmpeg-installer/ffmpeg`. Verify maintenance status before committing — `ffmpeg-static-electron` has uncertain upkeep as of 2026. Add to `electron-builder.yml`:

```yaml
asarUnpack:
  - "node_modules/ffmpeg-static-electron/**"
```

**Pipeline:**

```
desktopCapturer → canvas composite → raw frames via ImageData
                                          ↓
                              FFmpeg child process (stdin pipe)
                              -c:v h264_nvenc (or libx264 fallback)
                              -c:a aac
                              → output.mp4
```

Alternatively, use `MediaRecorder` for initial capture to a temp `.webm`, then FFmpeg for post-recording remux/transcode. This is simpler and still gets GPU encoding on the final output.

**Hardware encoder detection:**

```js
// Probe available encoders at startup
const { execSync } = require('child_process');
const encoders = execSync(`${ffmpegPath} -encoders`).toString();
const gpuEncoder = encoders.includes('h264_nvenc') ? 'h264_nvenc'
                 : encoders.includes('h264_qsv')   ? 'h264_qsv'
                 : encoders.includes('h264_amf')    ? 'h264_amf'
                 : 'libx264';
```

**4090-specific optimizations:**

With NVENC guaranteed, we can be aggressive with encoding settings:

```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 60 -i pipe:0 \
  -c:v h264_nvenc \
  -preset p4 \           # "medium" — good quality/speed balance
  -rc vbr \              # variable bitrate
  -cq 23 \               # constant quality (lower = better, 18-28 range)
  -b:v 20M \             # target 20 Mbps for 1080p60
  -maxrate 30M \         # cap for bitrate spikes (action scenes)
  -bufsize 40M \         # buffer for rate control
  -profile:v high \
  -g 120 \               # keyframe every 2 seconds (60fps × 2)
  -c:a aac -b:a 192k \
  output.mp4
```

NVENC encoding on the 4090 uses <2% GPU utilization. The encoder is physically separate silicon — it does not compete with rendering. This means zero performance impact during racing, even at 1080p60 or 1440p60.

**Estimated effort:** 1–2 weeks including encoder fallback logic and testing across GPU vendors.

---

### Phase 4 — Smart Recording + Telemetry Sidecar

These are the features that make this *better* than OBS for sim racing — and they're the foundation for the AI editing pipeline (see `premiere-replacement-plan.md`).

**Telemetry sidecar (`telemetry.jsonl`):**

This is the single most important output. During recording, write a JSON Lines file synced to video frames with every telemetry signal the poll engine captures:

```jsonl
{"t":0.000,"frame":0,"pos":3,"gap_ahead":1.2,"gap_behind":0.8,"speed":145,"incidents":0,"pit":false,"flag":"green","sector":1,"lap":1,"closest_car":0.4,"delta_best":-0.3}
{"t":0.033,"frame":1,"pos":3,"gap_ahead":1.1,"gap_behind":0.9,...}
```

This file drives the entire post-production pipeline: it tells the AI editor when to cut to TV view, when overtakes happened, when incidents occurred. Without it, you're back to scrubbing through footage by hand.

**Telemetry-aware recording:**
- Auto-start recording when car leaves pit lane (poll engine already has `IsInPitLane`)
- Auto-stop when session ends (`IsEndOfRace`) or car returns to pits
- Mark incidents in the sidecar using `IncidentCount` changes
- Auto-split recordings per stint or session

**Post-race replay guide:**

Immediately after recording stops, analyze the telemetry sidecar and present a "Replay Recording Guide" — a list of moments that need TV-view coverage for the editing pipeline. This tells the user exactly which replay segments to record from broadcast camera, instead of re-recording the entire race. See `premiere-replacement-plan.md` for the full replay workflow.

**Instant replay buffer:**
- Keep a rolling 30–120 second buffer in memory
- Hotkey to save the buffer as a clip (like OBS's replay buffer, but with telemetry bookmarks)

**Clip export for socials:**
- One-button "save last overtake" using incident/position-change telemetry events
- Auto-crop to vertical (9:16) for TikTok/Reels with car centered
- Overlay race position badge and track name as burned-in graphics

---

### Phase 5 — Automated Replay Director

**What:** After a race ends, the overlay takes over iRacing's replay system, records the TV-view footage for every moment that needs it, and hands the editing pipeline a complete set of source material — zero manual work.

**Why this is now a core feature (not a stretch goal):** With the 4090's NVENC, recording the replay costs nothing. And iRacing's replay system responds to standard keyboard shortcuts that Electron can send programmatically. The only question was "is this worth the complexity?" — and the answer is yes, because the alternative is asking the user to manually scrub through a replay, which is exactly the kind of tedious work this project exists to eliminate.

**How it works:**

```
Race ends
    ↓
Overlay analyzes telemetry.jsonl → identifies TV-view moments
    ↓
┌──────────────────────────────────────────────────────────┐
│  AUTOMATED REPLAY RECORDING                              │
│                                                          │
│  1. Overlay sends keypress to open iRacing replay        │
│  2. Switch to broadcast/TV camera (Ctrl+F12 or numpad)   │
│  3. For each TV-view moment:                             │
│     a. Jump replay to timestamp - 3s (lead-in)           │
│        → numpad shortcuts: fast-forward / frame-step     │
│     b. Start recording (NVENC, same pipeline as live)    │
│     c. Play replay at 1× speed through the moment        │
│     d. Stop recording at timestamp + 3s (tail)           │
│  4. Save all segments with matched telemetry timestamps   │
│  5. Notify user: "TV-view recording complete"             │
│                                                          │
│  Total time: roughly real-time for flagged moments only   │
│  A 20-min race with 3 min of TV-view moments ≈ 4 min     │
│  (3 min of moments + jump/settle time between segments)   │
└──────────────────────────────────────────────────────────┘
```

**iRacing replay keyboard commands (confirmed available):**

| Key | Action |
|-----|--------|
| `Numpad 5` | Pause/play replay |
| `Numpad 4/6` | Frame back/forward |
| `Shift+Numpad 4/6` | Rewind/fast-forward |
| `Numpad 7` | Jump to start |
| `Ctrl+F12` | Cycle camera groups (cockpit → TV → blimp, etc.) |
| `Numpad 8/2` | Previous/next car in current camera group |

Electron can send these via a lightweight native keyboard input module (`robotjs`, `@nut-tree/nut-js`, or direct `SendInput` via `ffi-napi`). The overlay already runs as always-on-top, so it can send keys to the iRacing window underneath.

**Segment recording strategy:**

Two options for how to handle multiple TV-view moments:

| Approach | How | Pros | Cons |
|----------|-----|------|------|
| **Start/stop per segment** | Record each moment as a separate file | Clean files, no trimming needed | Small gaps while jumping between moments |
| **One continuous take** | Start recording, jump between moments, stop at end | Single file, simpler pipeline | Includes fast-forward transitions (trimmed in post by the editor) |

**Recommended: one continuous take.** Start NVENC recording, play through the replay jumping to each moment, stop at the end. The editing pipeline already knows the exact timestamps — it can trim the jump/fast-forward sections. One file is simpler than 15 small ones, and disk space is irrelevant with modern drives.

**New files:**

| File | Purpose |
|------|---------|
| `modules/js/replay-director.js` | **New** — replay automation engine |
| `modules/js/keyboard-sender.js` | **New** — native key input to iRacing |

**IPC additions to `preload.js`:**

```js
k10.startReplayDirector(moments)  // → main process begins automated replay
k10.onReplayProgress(cb)          // → { currentMoment, total, status }
k10.cancelReplayDirector()        // → abort and save what we have
```

**Estimated effort:** 1–2 weeks. The replay keyboard automation is the only new technical risk; everything else reuses the existing recording pipeline.

---

## File Changes Summary

| File | Change |
|------|--------|
| `main.js` | IPC handlers for recording, FFmpeg process management, file I/O |
| `preload.js` | Recording bridge methods |
| `dashboard.html` | Load recorder modules |
| `modules/js/recorder.js` | **New** — capture + encoding pipeline |
| `modules/js/recorder-ui.js` | **New** — recording indicator + controls |
| `modules/styles/recorder.css` | **New** — recording UI styles |
| `settings.js` | Recording preferences panel |
| `keyboard.js` | New hotkey: `Ctrl+Shift+V` for record toggle |
| `poll-engine.js` | Emit events for auto-record triggers (pit status, session state) |
| `modules/js/replay-director.js` | **New** — automated replay recording engine |
| `modules/js/keyboard-sender.js` | **New** — native key input for iRacing replay control |
| `electron-builder.yml` | Unpack FFmpeg binary from asar |
| `package.json` | Add `ffmpeg-static-electron`, `@nut-tree/nut-js` (or similar) dependencies |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **System audio capture** requires native module or user setup | Users without VB-Audio can't record game sound | Ship with virtual audio cable setup wizard; build WASAPI addon as v2 |
| **60fps capture is fragile** in Electron | Multiple Electron issues (#8278, #24808, #41524) report MediaRecorder capping at 30fps on some systems | Target 30fps as default (sufficient for race footage), offer 60fps as opt-in with a "test capture" button that benchmarks before committing |
| **Performance overhead** of screen capture during racing | Frame drops in game or overlay | Use hardware encoding (NVENC), cap capture at 30fps even if game runs 144fps, monitor CPU/GPU usage |
| **FFmpeg binary size** adds ~40MB to installer | Larger download | Only bundle FFmpeg in Phase 3; Phase 1–2 use MediaRecorder (0 extra bytes) |
| **Capture includes overlay** since it's screen-level | Users may not want HUD in recording | Add "clean capture" mode that hides overlay during capture frames, or capture game window specifically |
| **DirectX fullscreen exclusive** games block `desktopCapturer` | Black frame capture | Document that borderless fullscreen is required (this is also an OBS limitation without game capture hook) |

## What This Doesn't Replace

Be honest about what OBS does that this project won't:

- **Streaming to Twitch/YouTube** — This is recording-only. Streaming requires RTMP/SRT encoding, which is a different pipeline. If streaming is needed later, it's a Phase 5.
- **Game capture hook** — OBS injects into the game process for zero-overhead capture. Electron can't do this without native modules that are essentially rewriting OBS's capture engine. We capture at the desktop compositor level instead.
- **Scene switching** — No concept of scenes. The overlay IS the scene. If you need to switch between a "racing" and "interview" layout, that's a different tool.
- **Plugin ecosystem** — No VST audio filters, no LUT application during capture. Post-processing happens in the editor.

## Timeline

| Phase | Scope | Effort | Depends On |
|-------|-------|--------|------------|
| 1 | Screen + mic recording | 2–3 days | Nothing |
| 2 | System audio + facecam | 1 week | Phase 1 |
| 3 | FFmpeg/NVENC encoder | 1–2 weeks | Phase 2 |
| 4 | Smart recording + telemetry sidecar | 2–3 weeks | Phase 3 |
| 5 | Automated replay director | 1–2 weeks | Phase 4 |

Total: ~7–9 weeks from start to full feature set including automated replay recording.

## Hotkey Summary

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+V` | Start/stop recording |
| `Ctrl+Shift+B` | Save instant replay buffer (last 30–120s) |
| `Ctrl+Shift+X` | Save last overtake/incident as clip |
| `Ctrl+Shift+P` | Start automated replay director (post-race) |

These integrate into the existing hotkey system in `keyboard.js` alongside the current overlay shortcuts (`Ctrl+Shift+S` for settings, `Ctrl+Shift+F` for drive HUD, etc.).
