# RaceCor Pro Drive — OBS Recording Mode Plan

*Drafted 2026-06-05. Companion to [`video-editor-plan.md`](video-editor-plan.md) — adds a third recording **producer** alongside the overlay's built-in recorder and the future Windows-native recorder.*

Today the overlay owns the whole recording stack: it screen-captures via Chromium's `getDisplayMedia`, composites the HUD + facecam onto a canvas, encodes with `MediaRecorder`, transcodes WebM→MP4 with ffmpeg, and emits a `.rcpdv` bundle (MP4 + telemetry sidecar). That is great for one-click capture but it is a closed pipeline — no scene composition, no multi-source mixing, no per-app audio, no streaming, and the encode quality is whatever Chromium gives us.

This plan adds an **OBS recording mode**: the user records and composes the video in OBS (scenes, sources, facecam, audio mixing, hardware encoder, streaming), while RaceCor still captures the **telemetry sidecar** in the exact format [`prodrive-edit`](video-editor-plan.md) ingests — so the "edit it down later" path is preserved untouched. The overlay is piped **into OBS only** (never onto the driving display) as a browser source that conforms to 16:9 or any custom canvas size.

## How this answers the brief

| Ask | Answer in this plan |
|-----|---------------------|
| Use OBS for video recording **and composition** | OBS owns the MP4 and the scene. RaceCor stops owning video in this mode. → [The split](#the-split) |
| **Telemetry still recorded** for later editing-down | A headless **telemetry companion** writes the same `.telemetry.jsonl` schema `prodrive-edit` already consumes, time-synced to OBS's record start/stop. → [Telemetry companion](#telemetry-companion--obs-sync) |
| "This might be an OBS plugin?" | A native plugin is **not** needed for the MVP — an OBS **Browser Source + obs-websocket companion** does everything you described with zero native code. A native plugin is a later UX/precision upgrade, weighed below. → [Do we need a native plugin?](#do-we-need-a-native-obs-plugin) |
| Pipe the overlay **just to OBS**, not on my main screen | The overlay renders inside OBS's embedded browser (CEF) as a scene layer. There is no window on the desktop. The companion runs headless. → [Broadcast overlay](#broadcast-overlay-169--custom-dimensions) |
| Overlay must conform to **16:9 / custom dimensions** | A new **broadcast layout mode** lays the HUD out to a fixed logical canvas (the video resolution) driven by URL params, decoupled from the physical monitor. → [Broadcast overlay](#broadcast-overlay-169--custom-dimensions) |

## The split

The core idea: **OBS owns pixels and audio; RaceCor owns telemetry and the broadcast overlay.** They meet at two seams — a browser source (visual) and a record-state trigger (sync).

```
   SimHub + RaceCor plugin            ┌──────────────────── OBS ────────────────────┐
   http://localhost:8889   ──────────┼─► Browser Source                             │
   (telemetry JSON / WS)         │    │     http://localhost:9090/?mode=broadcast    │
                                 │    │     &w=1920&h=1080   (transparent CEF layer) │
                                 │    │              +                               │
                                 │    │     game capture · facecam · audio mix ──────┼──► session.mp4
                                 │    │              +                               │      (OBS owns video
                                 │    │     obs-websocket :4455 ◄──────────┐         │       + composition)
                                 │    └────────────────────────────────────┼────────┘
                                 │                                         │
                                 │              record started/stopped + output path
                                 ▼                                         │
                 Telemetry companion (headless) ◄────────────────────────┘
                 reuses poll-engine.js + telemetry-sidecar.js, no window, no video
                                 │
                                 ▼
                 session.telemetry.jsonl  ──(same folder as the mp4)──►  prodrive-edit  ──► highlight edit
```

Two visual sub-modes fall out of this, and they matter because they change what the telemetry is *for*:

- **(a) Composed broadcast (default).** The overlay browser source lives in the recorded scene, so the HUD is **baked into** `session.mp4`. OBS did the composition; the recording is the finished broadcast look. The sidecar is captured **for editing-down only** — `prodrive-edit` uses it to *detect* events (overtakes, incidents, fast laps) and cut a highlight EDL, but does **not** re-composite a HUD (one is already burned in). Sync tolerance here is loose — cut boundaries are padded by seconds anyway. **This is what the brief describes.**
- **(b) Clean plate + sidecar (optional).** OBS records the game *without* the HUD (overlay omitted from the recording scene, or routed to a stream-only scene). The editor composites the HUD later from the sidecar, exactly like the built-in `.rcpdv` path. This keeps post-production flexibility but means OBS is *not* doing the overlay composition — so it is a secondary option, not the default. It needs frame-accurate sync (see [offset-aware sync](#phase-4--offset-aware-sync)).

Default to (a). Ship (b) only if users ask for OBS-quality encode *with* post-flexible overlays.

## Broadcast overlay (16:9 / custom dimensions)

### Why the current overlay can't just be dropped into OBS

The live overlay is a **corner-anchored HUD on a full-display transparent window** — `main.js` sizes the `BrowserWindow` to the physical display (e.g. 3440×1440 ultrawide) and reflows to it on `display-metrics-changed`. Layout is tied to the monitor, not to a video canvas. A 16:9 OBS scene needs the opposite: a **fixed logical canvas** the HUD lays out against, independent of whatever monitor the rig has.

Good news — the overlay is already a single self-contained web page (`dashboard.html`, all CSS/JS inlined) and `remote-server.js` already serves it over HTTP on **:9090**, already proxies the plugin at `:9090/racecor-io-pro-drive/*`, and already injects a `<script>` override block per request. OBS can load it as a Browser Source **today**; what's missing is a layout mode that targets a canvas instead of a screen.

### Broadcast layout mode

Add a `mode=broadcast` rendering path to `dashboard.html`, parameterised by URL query (read in `remote-server.js`'s inject block, or directly in the page):

| Param | Meaning | Example |
|-------|---------|---------|
| `mode` | `broadcast` selects the fixed-canvas layout (vs the default screen-anchored HUD) | `broadcast` |
| `w`, `h` | Logical canvas size in px — set these to the OBS **Base (Canvas) Resolution** | `1920`, `1080` |
| `aspect` | Convenience preset; sets a default `w`/`h` if not given | `16:9`, `21:9`, `9:16`, `4:3` |
| `safe` | Title-safe inset (%) so panels don't hug the bleading/overscan edge | `2.5` |
| `panels` | Optional comma list to show a broadcast-appropriate subset | `tach,laptimer,leaderboard,trackmap` |
| `bg` | `transparent` (default) · `green` · `magenta` — chroma fallback, see below | `transparent` |

Implementation shape:

- A `#stage` root sized to exactly `w`×`h`, `position: relative; transform-origin: top left`. Every panel is absolutely positioned **relative to `#stage`** (corners, lower-third), with the center left transparent so gameplay shows through.
- A single `--scale` CSS variable derived from canvas height drives all panel sizing (rem/clamp), so 1080p, 1440p and 4K renders look **proportionally identical** — only crispness changes.
- If the OBS Browser Source pixel size differs from the logical canvas, apply `transform: scale()` on `#stage` to fit. (Easiest: set the Browser Source W/H equal to `w`/`h` and let OBS scale the source in the scene.)
- **Transparency:** OBS Browser Sources are CEF with an alpha channel — `body { background: transparent }` composites straight over the sources below. No chroma key required. Keep `bg=green|magenta` as a documented fallback for any platform where CEF alpha misbehaves (this supersedes the half-built `greenScreen` setting / `Ctrl+Shift+G` path; that flag exists in `config.js` but its CSS was never finished, so don't depend on it).

### Presets (the "custom dimensions" surface)

Ship a tiny preset list (also the OBS Base-Resolution values to match):

| Preset | Canvas | Use |
|--------|--------|-----|
| 1080p 16:9 | 1920×1080 | Standard YouTube / Twitch |
| 1440p 16:9 | 2560×1440 | High-bitrate YouTube |
| 4K 16:9 | 3840×2160 | Archive / premium |
| Vertical 9:16 | 1080×1920 | Shorts / Reels / TikTok |
| Ultrawide 21:9 | 2560×1080 | Cinematic |
| Custom | any `w`×`h` | Matches a non-standard OBS canvas |

The URL is the contract; presets are just a UI affordance that writes the URL. Example Browser Source URL:
`http://localhost:9090/?mode=broadcast&w=1920&h=1080&safe=2.5`

### Independent of the driving display

Because this is a second, independent render of the same page, the broadcast overlay and the on-rig driving HUD are **decoupled**:

- **OBS-only:** run *just* the browser source — nothing on the desktop, the rig drives "blind" off the OBS preview (or not at all). This is the "pipe it just to OBS" case.
- **Both:** keep the existing Electron corner-HUD on the main monitor for driving *and* add the broadcast browser source in OBS at 16:9. Two renderers, one telemetry source (`:8889`), zero interference.

Audio and facecam stop being the overlay's problem in this mode — OBS mixes game/mic/discord audio natively and treats the facecam as just another source with its own filters. The overlay's canvas-compositing facecam PiP path (`recorder.js`) is simply unused under OBS mode.

## Telemetry companion + OBS sync

OBS produces the MP4. Something still has to produce the `session.telemetry.jsonl` that `prodrive-edit` pairs with it — synced to OBS's recording window. That's the **telemetry companion**: a headless reuse of the overlay's *existing* capture code, with the video half removed.

### What it is

- A new headless entry path in **`prodrive-overlay`** (no `BrowserWindow`, or a hidden one) that runs `poll-engine.js` (polls `:8889` at ~30fps) + `telemetry-sidecar.js` (writes the JSONL via the existing main-process IPC `fs` stream). **No `recorder.js`, no `getDisplayMedia`, no ffmpeg.**
- It connects to **obs-websocket** (built into OBS 28+, default `ws://localhost:4455`, optional password) and subscribes to `RecordStateChanged`.
- On `OBS_WEBSOCKET_OUTPUT_STARTED`: start the sidecar, zero `t` to this instant. On `OBS_WEBSOCKET_OUTPUT_STOPPED`: stop the sidecar (writes the `summary` line), then **name and move it next to OBS's output file** — the event payload carries `outputPath`, so the companion writes `<obs-basename>.telemetry.jsonl` in the **same directory** as the mp4.

Why reuse `prodrive-overlay` rather than a new binary: the sidecar schema, the marker detection (incidents/overtakes/laps/pit), the 30-frame write buffering, and the plugin property mapping all already live in `telemetry-sidecar.js` and are *the* contract `prodrive-edit` consumes. Re-implementing them elsewhere risks drift. (Per `video-editor-plan.md`'s open question, recording may later relocate to the Windows-native app — when it does, the companion moves with the sidecar writer.)

### Satisfying the ingest contract

`prodrive-edit` pairs files by **directory, not basename** — it globs `*.telemetry.jsonl` in a session folder and takes the most recent. So the only hard requirement is: **drop the sidecar in the same folder OBS wrote the mp4 to.** Co-naming on the mp4 basename is a nicety, not a requirement, but we'll do it for tidiness and to support multiple takes per folder.

The schema is unchanged from [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md): `header` line, `{t, frame, …}` rows, `summary` line. `prodrive-edit` reads relative `t` (seconds from t=0) and assumes **telemetry t=0 == video t=0** with no offset field. The MVP honours that by starting the sidecar exactly on the record-start event.

### Sync precision — good enough now, tighter later

The record-start *event* fires a few frames before/after the encoder's true first frame (pipeline latency). For sub-mode **(a)** — telemetry used only to *find* cut points — that's immaterial; cuts are padded by seconds. For sub-mode **(b)** — editor re-composites the HUD over the OBS video — it matters, and we tighten it in [Phase 4](#phase-4--offset-aware-sync) with an explicit offset field + `outputTimecode` correction, plus a small `prodrive-edit` change to honour the offset. Until then, (b) is "experimental."

## Do we need a native OBS plugin?

You asked specifically. Short answer: **no — not for anything in the brief.** Here's the honest comparison.

| Approach | What it gives | Cost | Verdict |
|----------|---------------|------|---------|
| **Browser Source + obs-websocket companion** | Overlay in OBS at any canvas size; headless telemetry sidecar synced to record start/stop; reuses 100% of existing overlay + sidecar code | Layout mode in `dashboard.html`; small companion entry path; obs-websocket dependency (built into OBS, user enables once) | ✅ **Recommended MVP.** Everything in the brief, zero native code, ships fast. |
| **OBS Lua/Python script** | In-OBS record-start/stop hook (`obs_frontend_add_event_callback`) that launches/stops the companion and hands it the output path — no external WebSocket | Script per-platform; OBS-Python version-matching is famously fragile; still needs the companion for fs + telemetry decode | ⚖️ Marginal. Only removes the obs-websocket setup step; the script is just a *trigger* handing off to the same companion. Consider as packaging sugar, not architecture. |
| **Native C/C++ plugin (libobs)** | First-class OBS UI ("RaceCor Telemetry" output/dock), frame-accurate sync to the encoder timeline, single-install UX, could embed telemetry as a timed metadata track | C/C++ build + sign + notarize **per platform** (Win + Mac); tracks OBS API churn; still must talk to `:8889` for data; **rendering the HUD natively would mean re-implementing the entire web overlay in C++/GL — not worth it** | 🅿️ **Deferred.** Its only real wins are UX packaging and frame-accurate sync — both reachable incrementally (Phase 4/6) without it. Revisit if the companion's sync or setup friction proves inadequate in practice. |

The instinct that "this might be a plugin" is reasonable, but the overlay is *already a web app*, and OBS's Browser Source is *built to host web apps*. Rendering is solved for free; the only thing a plugin would add is a tighter sync clock and a nicer install — neither blocks the brief.

## Phasing

1. **Phase 1 — Broadcast layout mode in `prodrive-overlay`.** `mode=broadcast`, `w`/`h`/`aspect`/`safe` params, fixed `#stage` canvas, `--scale` sizing, transparent background, preset list. Verifiable in a plain browser tab and as an OBS Browser Source. No telemetry work yet. *Deliverable: the overlay renders a clean 16:9 (and custom) HUD that composites over a video layer.*
2. **Phase 2 — Telemetry companion + obs-websocket co-start sync.** Headless `poll-engine` + `telemetry-sidecar`, obs-websocket subscription, sidecar started/stopped on record events, written next to `outputPath`. *Deliverable: hit Record in OBS → `session.mp4` + `session.telemetry.jsonl` land in the same folder.*
3. **Phase 3 — Edit-pairing validation.** Drop an OBS-produced `mp4` + companion `telemetry.jsonl` into `prodrive-edit`; confirm ingest, event detection, and a rendered highlight. *Deliverable: the "edit it down" path works end-to-end from an OBS recording.*
4. **Phase 4 — Offset-aware sync.** Add `videoStartUtc` + `videoOffsetMs` to the sidecar header (additive, see [schema addendum](#schema-addendum)); derive the offset from obs-websocket `outputTimecode`/`outputDuration`; teach `prodrive-edit` to apply it. *Deliverable: frame-accurate alignment, unlocking sub-mode (b) and burned-in re-composites.*
5. **Phase 5 — Optional `.rcpdv` re-bundle.** A finalize step wraps OBS's mp4 + the sidecar into a `.rcpdv` using the existing [`race-bundle-format`](../.claude/skills/race-bundle-format/SKILL.md) writer (it just appends a `uuid` box to any MP4), so OBS recordings archive identically to built-in ones. *Deliverable: OBS sessions are first-class `.rcpdv` bundles too.*
6. **Phase 6 — Packaging / UX.** An OBS scene-collection + profile template ("RaceCor 1080p"), a one-click "Set up OBS" action (auto-enable obs-websocket, add the browser source, import the scene), and companion autostart alongside the overlay's iRacing detector. *Deliverable: a non-technical setup.*
7. **Phase 7 — Clean-plate sub-mode (b).** Document/template the HUD-on-stream-only-scene arrangement; rely on Phase 4 sync so the editor composites the HUD post-hoc. *Deliverable: OBS-quality encode with post-flexible overlays.*
8. **Phase 8 (optional, deferred) — Native OBS plugin or Lua/Python script.** Only if Phase 6 packaging or Phase 4 sync proves insufficient. Scope: in-OBS dock + encoder-timeline sync. Not rendering.

Phases 1–3 are the usable MVP. 4–6 are the polish that makes it broadcast-grade. 7–8 are optional.

## Cross-repo touch points

| Repo | Change |
|------|--------|
| **`prodrive-overlay`** | New `mode=broadcast` layout in `dashboard.html` + CSS; param parsing in `remote-server.js` inject block; new **headless companion** entry path reusing `poll-engine.js` + `telemetry-sidecar.js` + main-process sidecar IPC; obs-websocket client; optional `.rcpdv` finalize via the bundle writer. |
| **`prodrive-edit`** | Phase 4 only: read optional `videoOffsetMs`/`videoStartUtc` from the sidecar header and shift the telemetry timeline by it (currently it ignores the header and assumes t=0==video-0). Additive, backward-compatible. |
| **`prodrive-plugin`** | None required (the companion uses the existing `:8889` HTTP API, or later the `:8890→:8889` WebSocket). |
| **`prodrive-agents`** | This plan; update the [`prodrive-context` index](README.md) and mirror any new sidecar field into [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md). |
| **`prodrive-windows`** | Eventually hosts the companion autostart / OBS setup UX (Phase 6), consistent with `video-editor-plan.md`'s "recording relocates to the native app" arc. |

## Schema addendum (Phase 4)

Per the [sidecar schema's "adding a field" contract](telemetry-sidecar-schema.md#adding-a-new-field--the-contract), additive optional header fields don't bump `schemaVersion`. Proposed additions to the **header** line, written only by the OBS companion:

| Field | Type | Notes |
|-------|------|-------|
| `producer` | `string` | `"obs"` vs the default `"overlay"` — lets consumers branch on whether a HUD is already burned in (sub-mode a vs b). |
| `videoStartUtc` | `string` | ISO-8601 instant of the video's first frame, from obs-websocket. |
| `videoOffsetMs` | `number` | Signed correction so `t_video = t + videoOffsetMs/1000`, derived from `outputTimecode`. `0` when co-start is exact. |
| `obsOutputPath` | `string \| null` | The mp4 path OBS reported, for provenance / co-naming. |

Per-frame rows are unchanged. Consumers that ignore these fields keep working (the MVP co-start already aligns t=0 to video-0); `prodrive-edit` opts in during Phase 4.

## Open questions

- **obs-websocket setup friction.** It ships with OBS 28+ but is off by default and may need a password. Phase 6's one-click setup should toggle it via the OBS config file or guide the user. If this proves too fiddly for non-technical users, it's the strongest argument for the Phase 8 native plugin (which needs no WebSocket). 
- **Which clock wins for (b).** OBS `outputTimecode` (encoder timeline) vs wall-clock vs the sim's estimated `SessionTimeSpan` (the plugin exposes no native iRacing `SessionTick`). Leaning encoder-timecode for video alignment; the sim clock stays orthogonal (useful only to cross-reference the cloud-pushed session). Validate empirically in Phase 4.
- **Multiple takes / split recording.** OBS "Automatic File Splitting" produces several mp4s per session; the directory-pairing rule takes the newest sidecar. Decide whether the companion splits the sidecar in lockstep or writes one continuous file spanning the splits.
- **Burned-in vs re-composited, surfaced to the editor.** In (a) the HUD is already in the pixels; the editor must *not* draw a second one. The `producer: "obs"` flag is the signal, but the editor UI needs to respect it (disable the overlay-composite layer). Confirm when the native editor lands.
- **Does the broadcast layout want fewer panels?** A full-frame 16:9 broadcast composition may want a curated subset (lower-third + tach + leaderboard) rather than the dense driving HUD. The `panels=` param covers it mechanically; the default broadcast panel set is a design decision for `prodrive-designer`.

## Companion docs

- [`video-editor-plan.md`](video-editor-plan.md) — the editor + `.rcpdv` pipeline this feeds; OBS mode is a third *producer* into the same consumer
- [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md) — the JSONL contract the companion must emit and `prodrive-edit` consumes
- [`skills/race-bundle-format/`](../.claude/skills/race-bundle-format/SKILL.md) — `.rcpdv` writer reused in Phase 5 to wrap OBS output
- [`archive/monorepo-orchestration.md`](archive/monorepo-orchestration.md) — cross-repo data flow / ports (`:8889` plugin, `:9090` overlay server) this slots into
- [`prodrive-plugin/docs/WEBSOCKET_PROTOCOL.md`](../apps/plugin) — the `:8890→:8889` push stream the companion may subscribe to instead of polling
