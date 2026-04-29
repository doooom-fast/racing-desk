# RaceCor Pro Drive — Video Editor Plan

*Drafted 2026-04-27. Supersedes ad-hoc notes in `prodrive-edit/` and `prodrive-designer/`.*

The two existing standalone tools — `prodrive-edit` (Node/CLI ffmpeg pipeline) and `prodrive-designer` (Electron HUD prototyping) — converge into a single native video editor that ships inside the macOS and Windows apps. The web app does not edit video. It consumes the YouTube-uploaded result.

This doc is the architectural commitment for that work.

## What the existing tools become

| Old tool | What's kept | What's dropped |
|---|---|---|
| `prodrive-edit` | Analysis brain — `scoring-engine.js`, `detect-events.js`, `edl-generator.js`, the Claude director prompt. ~600 LOC of pure JS that ports cleanly. | The Node CLI shell. The native-ffmpeg `ffmpeg-assembly.js` is *kept* as the desktop renderer (called via `child_process` from Electron / Swift `Process` / .NET `Process`). |
| `prodrive-designer` | UX layout (toolbar, stage, picker, side panel), the sidecar replayer (`replayer/sidecar-server.js` + `sidecar-mapper.js`), the Claude chat panel pattern. | The Electron `<webview>` isolation, the IPC plumbing, the dashboard-source HMR. Not needed in the editor. |

Neither old repo gets a code transplant — they get raided for ideas and pure-JS modules. The editor itself is new code in `apps/<name>/Editor/` inside `prodrive-macos` and `prodrive-windows`.

## The roster

| Surface | Role | Stack |
|---|---|---|
| `prodrive-macos/apps/native/Editor/` | Primary editor — timeline UI, Claude director, ffmpeg render | SwiftUI + AVFoundation + bundled ffmpeg binary |
| `prodrive-windows/apps/native/Editor/` | Secondary editor — same UX, recorded sessions land here first | WinUI 3 + Media Foundation + bundled ffmpeg binary |
| `prodrive-overlay/` | Records `.rcpdv` bundles at session end (already records video; gains the bundling step) | Electron, no editor UI |
| `prodrive-server/apps/web/drive/debrief/[id]/` | Plays the **YouTube-uploaded** result alongside race details | Next.js, embeds YouTube iframe |
| `prodrive-ios`, `prodrive-tvos` | Reviewers — play YouTube video alongside race details, leave reactions | SwiftUI + AVPlayer |

The web app never receives source video. Only the YouTube URL + race metadata.

## The `.rcpdv` portable bundle format

Single-file format combining race video + telemetry sidecar. Spec lives in [`skills/race-bundle-format/`](../skills/race-bundle-format/SKILL.md).

- Standard MP4 (plays in QuickTime / VLC / Finder Quick Look)
- Telemetry embedded as an ISO-BMFF `uuid` box with a Prodrive-assigned UUID
- JSONL telemetry gzipped (~10× compression)
- Header: schema version, frame count, duration, race summary, recording app version
- Extension: `.rcpdv` — double-clicks as video; Prodrive tools detect by extension or by reading the `uuid` box

YouTube ignores the box on upload, so the public copy is a clean MP4. The local archive keeps telemetry attached.

## Transfer path: Windows → Mac

Recording happens on the rig (Windows). Editing happens on a MacBook. Bundles must move between them. Spec lives in [`skills/bundle-transfer/`](../skills/bundle-transfer/SKILL.md).

**Tier 1 — LAN (default):** Mac advertises a Bonjour service `_prodrive._tcp`. Windows discovers, shows "Send to MacBook" button, HTTP POSTs the bundle directly. Same network, no internet, no account plumbing.

**Tier 2 — Internet fallback:** When LAN discovery fails, Windows uploads to Vercel Blob via a signed URL issued by `prodrive-server`. Mac subscribes to a tiny SSE endpoint and pulls when notified. Server is a relay — bundle has 24hr TTL, deleted on fetch.

Both tiers wrap the same `.rcpdv` payload. No compression beyond what's already in the file.

## Web's role: YouTube consumer

`/drive/debrief/[sessionId]/` (existing route, auth-gated) renders:
- Embedded YouTube iframe (the rendered/uploaded edit)
- Race details, telemetry charts, lap timeline
- Reviewer reactions / comments
- Link to "open in editor" → deep-link to native app via `racecor-native://session/<id>`

No video upload UI on web. No editor on web. The "view a previous race" path is YouTube embed + DB-backed race details. Lightweight.

## Claude API auth

Anthropic banned third-party-app OAuth on April 4, 2026 (Pro/Max OAuth tokens are reserved for Claude Code and Claude.ai only). Spec lives in [`skills/server-claude-broker/`](../skills/server-claude-broker/SKILL.md).

**Default — server-brokered:** Native apps authenticate via the existing Discord/PKCE flow. They call `prodrive-server/api/v1/director` with the EDL request. Server holds one Anthropic API key, makes the call, returns the result. Per-user rate limits enforced server-side. Cost lives with Pro Drive subscription pricing.

**Escape hatch — BYOK:** Settings field in each native app accepts an Anthropic API key. Stored in Keychain (Mac) / Credential Manager (Win). Calls go direct to `api.anthropic.com` — bypass server entirely. Useful for power users hitting rate limits.

No OAuth-to-Claude path. If Anthropic ships a real third-party developer OAuth flow, revisit then.

## Editor architecture

Spec lives in [`skills/native-video-editor/`](../skills/native-video-editor/SKILL.md). Core pipeline:

```
.rcpdv bundle
   ↓
[demux] → AVAsset / MediaFoundation source + extracted .telemetry.jsonl
   ↓
[analyze] — pure-JS (or Swift/C# port) of prodrive-edit's scoring-engine + detect-events
   ↓                                                                    ↓
   ├──→ EDL generator (heuristic cuts, camera hysteresis)               │
   │                                                                    │
   └──→ Claude director (POST → server broker, returns refined EDL)    │
                                                                        │
   ↓                                                                    │
[edit-decisions.json] ← user manually tweaks via timeline UI ←──────────┘
   ↓
[render] — bundled ffmpeg binary, native subprocess
   ↓
output.mp4 → user clicks "Upload to YouTube" → OAuth → resumable upload from native app
```

The timeline UI is the prodrive-designer layout: video stage with overlay composite, scrub bar, side panel for Claude chat. Pickers, grids, and HMR are dropped — the editor isn't iterating on overlay design.

## Phasing

1. **Phase 1 — `.rcpdv` writer in `prodrive-overlay`.** Existing recording becomes a bundle producer. No editor yet. Bundles written to `~/Documents/RaceCor/sessions/`.
2. **Phase 2 — Mac editor MVP.** Open a `.rcpdv`, view the heuristic EDL, scrub timeline, render via bundled ffmpeg. No Claude. No transfer. Validates the editor UX.
3. **Phase 3 — Server Claude broker.** `/api/v1/director` shipped on prodrive-server. Mac editor gets a "Refine with Claude" button.
4. **Phase 4 — Bonjour transfer.** Windows sends to Mac over LAN.
5. **Phase 5 — Blob fallback transfer.** Same UX, internet path.
6. **Phase 6 — YouTube upload from native app.** OAuth via system browser, resumable upload.
7. **Phase 7 — Web debrief page consumes uploaded YouTube URL.** `/drive/debrief/[id]` shows embedded video alongside race details.
8. **Phase 8 — Windows editor.** Same architecture, WinUI 3 surface. Reuses the analysis port and the bundled ffmpeg.
9. **Phase 9 — iOS/tvOS reviewer experience.** YouTube playback + race details + reactions. No editor, no upload.
10. **Phase 10 — BYOK setting.** Last because most users won't need it.

## Open questions

- **Recording relocation: overlay → Windows native app.** Today the overlay records via Chromium's `desktopCapturer` + `MediaRecorder` (a video-call API repurposed). Long-term the recorder belongs in the WinUI 3 native app using Media Foundation directly — better encode quality, App Loopback per-game audio, HDR/10-bit, no WebM→MP4 transcode step, and the overlay shrinks back to pure HUD. The bundle format is the abstraction that makes the move clean (consumers don't care which producer wrote the bytes). Deferred — too disruptive to mix with the rest of Phase 1-7. Planned as a dedicated arc once the editor is shipping. Until then, the overlay is the producer.
- **Historical race library.** The native apps need to load *previous* races for editing/review, not just the live one. Where do bundles live, how does the editor browse them? Options: per-device library scanning `~/Documents/RaceCor/sessions/`, server-indexed library with bundles transferred on demand, or a hybrid (server tracks the manifest, device holds the bytes). Decision deferred until Phase 2 is shipped — empirical use of one device first will tell us whether multi-device sync is worth the complexity.
- **EDL portability across editor versions.** If the editor's analysis algorithm changes between releases, do old `edit-decisions.json` files still produce a faithful render? Probably want the EDL to embed the editor version it was authored with, and refuse to load on mismatch (or offer a "re-analyze" button).
- **Reviewer round-trip.** When an iOS reviewer leaves a reaction at timestamp X, does that flow back into the editor for a v2 cut? Out of scope for now; revisit after Phase 9.

## Companion docs

- [`skills/race-bundle-format/`](../skills/race-bundle-format/SKILL.md) — `.rcpdv` spec, schema, parsing/writing
- [`skills/bundle-transfer/`](../skills/bundle-transfer/SKILL.md) — Bonjour LAN + Vercel Blob fallback transfer
- [`skills/server-claude-broker/`](../skills/server-claude-broker/SKILL.md) — Server-side Claude API broker + BYOK pattern
- [`skills/native-video-editor/`](../skills/native-video-editor/SKILL.md) — Editor pipeline (analysis → EDL → ffmpeg render)
- [`native-apps-plan.md`](native-apps-plan.md) — The broader native apps roster the editor lives inside
- [`monorepo-orchestration.md`](monorepo-orchestration.md) — Cross-repo data flow this slots into
