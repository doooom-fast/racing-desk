---
name: native-video-editor
description: |
  The native video editor architecture shipped in prodrive-macos and prodrive-windows. Pipeline: open `.rcpdv` bundle → analyze (port of prodrive-edit's scoring/event-detection) → generate EDL → optional Claude refinement via server broker → user tweaks on a timeline UI (lifted from prodrive-designer's layout) → render via bundled ffmpeg subprocess → upload to YouTube. Use this skill when implementing or modifying any editor feature: timeline UI, EDL editing, render pipeline, bundled-ffmpeg invocation, YouTube upload OAuth, or the analysis port from JS to Swift/C#. Also trigger on "editor", "EDL", "render", "timeline", "ffmpeg", or "YouTube upload".
---

# Native Video Editor

The editor is a SwiftUI surface (`prodrive-macos/apps/native/Editor/`) and a WinUI 3 surface (`prodrive-windows/apps/native/Editor/`) that share an architecture but not code. Each owns its full toolchain. The work *they* share is consuming `.rcpdv` bundles, applying the analysis pipeline, and producing a rendered MP4.

This skill is the architectural contract both implementations follow.

## How to Use This Skill

1. Read this file for the pipeline shape and the per-stage contracts
2. For analysis-port specifics (Swift vs C# of `scoring-engine.js`), read `references/analysis-port.md`
3. For ffmpeg subprocess invocation patterns, read `references/ffmpeg-runner.md`
4. When implementing a new editor feature, identify which pipeline stage it lives in — don't sprawl a feature across stages

## The pipeline

```
[1. Open]    .rcpdv bundle  ──▶  AVAsset (mac) / MediaSource (win) + telemetry frames
[2. Analyze] frames             ──▶  events[] + scores[] + heuristic EDL
[3. Refine]  EDL + frames       ──▶  POST /api/v1/director  ──▶  refined EDL  (optional)
[4. Edit]    EDL                ──▶  user-tweaked EDL via timeline UI
[5. Render]  EDL + .rcpdv    ──▶  bundled ffmpeg subprocess  ──▶  output.mp4
[6. Upload]  output.mp4         ──▶  YouTube Data API v3 resumable upload
```

Each stage has a defined input and output type. Stages don't reach across — `Refine` doesn't call ffmpeg; `Render` doesn't call Claude. Keeping stages disciplined makes the editor testable and makes platform parity easy to audit.

## Stage 1 — Open

The user picks a `.rcpdv` from the library (browse `~/Documents/RaceCor/sessions/`). Editor parses the bundle:

- **Video track:** mac uses `AVAsset(url:)`, win uses `MediaPlayer.Source.CreateFromUri()`. Don't extract — play directly from the bundle file (the bundle's `uuid` box doesn't disturb video playback).
- **Telemetry:** parse the `uuid` box per [`race-bundle-format/SKILL.md`](../race-bundle-format/SKILL.md). Result is `[TelemetryFrame]` indexed by `t` (seconds since session start).

Editor caches the parsed telemetry to a sibling file `<bundleId>.parsed.bin` (binary plist on mac, BinaryFormatter on win) so re-opening the same bundle is instant. Cache invalidates on bundle mtime change.

## Stage 2 — Analyze

Pure-functional stage. Inputs: telemetry frames + video metadata. Output: `EDL` struct. No I/O, no UI, fully testable.

This is the **port** of `prodrive-edit`'s pure JS modules:
- `src/analyze/scoring-engine.js` (227 LOC) — frame scoring with TV-interest, mechanical hysteresis
- `src/analyze/detect-events.js` (201 LOC) — event detection (battles, overtakes, incidents)
- `src/analyze/edl-generator.js` (132 LOC) — EDL composition, segment ranking

Port targets:
- macOS/iOS/tvOS: Swift, `Sources/Editor/Analysis/*.swift`
- Windows: C#, `Editor/Analysis/*.cs`

The port must be **algorithmically identical** to the JS reference. Same input → same output bytewise (after JSON serialization). Reasons:
1. Server-brokered Claude calls send the heuristic EDL to the API; if mac and win produce different EDLs from the same bundle, Claude returns different refinements, and users see drift between platforms.
2. Reviewers on iOS/tvOS may eventually run the same analysis to validate cuts; algorithmic drift = different verdicts.

Practical strategy:
- Keep `prodrive-edit/src/analyze/*` as the **reference implementation** (canonical JS). Don't delete it.
- Each native port has a test harness that loads a fixture `.rcpdv`, runs analysis, compares output to a JSON fixture produced by the JS reference. Drift = test fail.
- When the algorithm changes, update JS reference first, regenerate fixtures, then update native ports. Versioned via the `EDL.analyzerVersion` field.

The EDL struct:

```swift
struct EDL: Codable {
  let bundleId: String
  let analyzerVersion: String        // "1.0.0" — matches the algorithm version
  let createdAt: Date
  let segments: [Segment]
  let totalDuration: TimeInterval

  struct Segment: Codable {
    let id: UUID
    let sourceStart: TimeInterval    // start in source video
    let sourceEnd: TimeInterval
    let camera: Camera                // .cockpit | .tv | .replay
    let score: Double                 // 0..1 editorial-interest
    let events: [EventRef]            // why we picked this segment
    let label: String?                // human-readable (Claude or user)
  }
}
```

## Stage 3 — Refine (optional)

User clicks "Refine with Claude". Editor POSTs to the server broker per [`server-claude-broker/SKILL.md`](../server-claude-broker/SKILL.md):

```
POST /api/v1/director
Body: { purpose: "edl-refine", input: { edl: <stage 2 output>, telemetryDigest: <summary>, userPreferences: {...} } }
```

The server applies the editorial system prompt and returns a refined EDL. Editor diffs old → new and surfaces changes ("Claude tightened the lap-3 battle, dropped the formation lap, swapped two camera cuts"). User can accept / reject the whole refinement or per-segment.

Failure modes (network down, rate-limit, BYOK rejected): show an inline error, keep the heuristic EDL. The editor must work fully without Claude — Refine is additive.

`telemetryDigest` is a downsampled summary (events list + per-lap aggregates), not the full frame array. Sending 5MB of JSON to the API on every refine is wasteful; the server prompt is built around the digest shape.

## Stage 4 — Edit (timeline UI)

This is the prodrive-designer layout, simplified:

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar:  [Play/Pause] [Scrub] [Camera: cockpit/tv/replay]   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   [Video stage with overlay composite]                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ┌──┐ ┌────┐ ┌──┐ ┌──────────┐  Timeline (segments)         │
│  └──┘ └────┘ └──┘ └──────────┘                              │
├──────────────────────────────────────────────────────────────┤
│ Side panel:  [Segment details] [Claude chat] [Render]        │
└──────────────────────────────────────────────────────────────┘
```

Operations the user can do:
- Drag segment edges (trim) — updates `sourceStart`/`sourceEnd`
- Reorder segments (drag-to-reorder) — updates segment array order
- Delete segment — removes from EDL
- Switch segment camera — updates `camera`
- Edit segment label — updates `label`
- Rerun analysis (resets to fresh heuristic EDL, preserving labels)
- Refine with Claude (Stage 3)

Operations explicitly **not** supported in v1:
- Trimming below source frame boundary (causes ffmpeg seek issues — clamp to keyframe)
- Cross-source edits (only one bundle at a time; multi-bundle stitching is out of scope)
- Audio editing beyond the source's existing audio
- Title cards, transitions, color grading (we're not Final Cut)

The editor is opinionated — it picks moments, refines them, hands off. Pixel-precision editing happens elsewhere if at all.

## Stage 5 — Render

Bundled ffmpeg binary lives in:
- macOS: `prodrive-macos/apps/native/Resources/ffmpeg` (universal binary, ~80MB after strip)
- Windows: `prodrive-windows/apps/native/Resources/ffmpeg.exe` (~70MB)

Both pinned to a specific ffmpeg version (track in `apps/native/Resources/FFMPEG_VERSION`). Bumping is a deliberate change because filter syntax and encoder defaults shift between versions.

The render pipeline reuses `prodrive-edit/src/render/ffmpeg-assembly.js`'s logic — concat demuxer with per-segment trim filters. Adapt for subprocess invocation:

```swift
// macOS — Sources/Editor/Render/Renderer.swift
let process = Process()
process.executableURL = Bundle.main.url(forResource: "ffmpeg", withExtension: nil)
process.arguments = [
  "-f", "concat", "-safe", "0", "-i", concatListPath,
  "-c:v", encoder,            // detectEncoder() — h264_videotoolbox on Mac, libx264 fallback
  "-preset", "fast",
  "-crf", "20",
  "-c:a", "aac", "-b:a", "192k",
  outputPath
]
process.standardOutput = pipe
process.standardError = pipe
try process.run()
```

Encoder selection per platform:
- macOS Apple Silicon: `h264_videotoolbox` (HW accelerated, fastest, good quality)
- macOS Intel: `h264_videotoolbox` (still HW; older VT is acceptable)
- Windows + NVIDIA: `h264_nvenc`
- Windows + AMD: `h264_amf`
- Windows + Intel: `h264_qsv`
- Fallback (no HW detect): `libx264` with `-preset fast`

Detect via `ffmpeg -encoders` parse on first launch, cache result. Don't redetect every render.

Progress reporting: ffmpeg writes `frame=...` lines to stderr. Parse those, compute percentage from total frames, emit progress to UI. On completion, fsync the output file before reporting "done".

Cancel: terminate the subprocess (`SIGTERM` then `SIGKILL` after 2s). Delete partial output.

## Stage 6 — Upload to YouTube

YouTube Data API v3 supports CORS resumable uploads. From a native app, use the standard YouTube SDK or raw OAuth2 + multipart resumable upload.

OAuth flow:
1. User clicks "Upload to YouTube" → editor opens system browser to Google OAuth consent (`https://accounts.google.com/o/oauth2/v2/auth?client_id=...&scope=youtube.upload&redirect_uri=racecor-native://youtube-auth&response_type=code&...`)
2. User consents, browser redirects to `racecor-native://youtube-auth?code=XXX`
3. OS hands URL to native app via URL scheme
4. App POSTs `code` to Google's token endpoint, receives access + refresh tokens
5. Tokens stored in OS keychain (`com.racecor.prodrive.youtube`)
6. Refresh on 401

Resumable upload:
1. POST metadata to `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
2. Response includes `Location` header — the upload URL
3. PUT video bytes to that URL in chunks (256KB minimum, 8MB recommended). On network failure, query upload status with `Content-Range: bytes */<size>` to find resume point.
4. On completion, response includes the `videoId`. Editor stores it in DB (linked to `bundleId`) and forwards to prodrive-server for the debrief page.

Metadata defaults (overridable in upload UI):
```json
{
  "snippet": {
    "title": "<race title from bundle header>",
    "description": "<auto-generated from race + EDL>\n\nEdited with Pro Drive — https://racecor.io",
    "tags": ["sim racing", "iRacing", "<track>", "<car>"],
    "categoryId": "17"  // Sports
  },
  "status": {
    "privacyStatus": "unlisted",  // ★ default — user opts into public
    "embeddable": true,
    "license": "youtube"
  }
}
```

Default to **unlisted** — the user explicitly clicks "Make public" in the upload dialog if they want that. Avoids accidental public uploads of in-progress edits.

After upload, the editor POSTs to prodrive-server:

```
POST /api/v1/sessions/:sessionId/youtube
Body: { youtubeId, title, uploadedAt, privacyStatus }
```

Server stores the link, the debrief page picks it up, the iOS/tvOS reviewer experience can load it.

## Library / browse

Editor opens with a library view: scan `~/Documents/RaceCor/sessions/` for `*.rcpdv`, read each bundle's header (cheap — just the `uuid` box), display as a grid. Sort by `createdAt` desc. Click to open in editor.

When the library scanner finds a bundle whose telemetry header references a `sessionId` not yet known to the local DB, fetch session metadata from `prodrive-server/api/v1/sessions/:sessionId` to enrich the library card (race title, track image, car logo).

## When NOT to use this skill

- Web-side video features — the web app doesn't edit. Use the YouTube embed pattern in `apps/web/src/app/drive/debrief/[id]/`, not this.
- iOS/tvOS reviewer app — that's playback only (AVPlayer + reactions), not the editor.
- prodrive-overlay's recording side — recording produces the bundle, doesn't analyze. See `prodrive-overlay/CLAUDE.md`.
- Third-party video tools (DaVinci, Final Cut) — out of scope. The editor is opinionated for race highlights, not general video.

## Companion docs

- [`prodrive-context/video-editor-plan.md`](../../prodrive-context/video-editor-plan.md) — Why the editor exists, where it ships
- [`race-bundle-format/SKILL.md`](../race-bundle-format/SKILL.md) — Format the editor consumes
- [`bundle-transfer/SKILL.md`](../bundle-transfer/SKILL.md) — How bundles arrive on the editor's machine
- [`server-claude-broker/SKILL.md`](../server-claude-broker/SKILL.md) — Refine-with-Claude path
- [`web-to-native-migration/SKILL.md`](../web-to-native-migration/SKILL.md) — Patterns for keeping native and web data in sync (relevant when editor talks to server)
