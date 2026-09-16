# Livery Builder — Plan & Scoping

**Status:** Scoping / pre-implementation
**Target product:** Pro Drive (new feature)
**Target sim:** iRacing (primary)
**Last updated:** 2026-04-18

## The Problem

Painting cars for iRacing is slow and frustrating. The user-reported pain points, in order of severity:

1. **Asymmetric mirror-logo work.** Logos on opposite sides of the car need to be in the *same 3D position* but in *reversed order* (so the lead logo on the right side is the lead logo on the left side, even though the TGA file places them in opposite pixel positions). Doing this by hand in Photoshop is tedious and error-prone.
2. **Can't visualize the TGA wrapped on the car.** TGA files are flat rectangles that unwrap onto a complex 3D surface. Mapping "this pixel region" → "this car panel" mentally is close to impossible.
3. **Slow iteration loop.** Export TGA → save to `Documents\iRacing\paint\<car>\` → alt-tab to iRacing 3D Car Viewer → reload → inspect → back to editor. Every iteration is 30+ seconds of context-switching.
4. **Precise placement.** Getting a logo at exactly the right spot on a panel without overshooting a seam or UV boundary is fiddly.

## The Constraint That Shapes Everything

iRacing car models are distributed as encrypted `.mdl` files. The legal line that actually matters is **who copies and distributes the assets**, not what gets rendered:

- **Server-hosted extracted meshes (even behind closed source, even obfuscated):** you become the distributor of iRacing's copyrighted assets. This is the risky posture. Closing your web source does not change this — a closed server hosting `.glb` files is still a server hosting extracted assets.
- **User-local extraction from the user's own install, meshes never leave their machine:** defensible. You're a tool vendor, not an asset distributor. This is the posture that lets SimHub, CrewChief, iRacing telemetry analyzers, and mod managers exist without constant legal trouble. They all read iRacing's install files on the user's machine; none of them host extracted game data.

### The Electron-local architecture is the unlock

The overlay is already a full Electron app with Node.js access on the user's machine. This gives us a clean legal framing:

- We distribute the **tool** (Electron binary). It contains no iRacing assets.
- The user's install of iRacing contains their legitimately-licensed copy of the assets.
- At runtime, on the user's machine, the tool reads their copy — the same way any mod manager or telemetry analyzer does.
- The only data that touches our servers is paint project metadata and the user's own uploaded artwork.

No bytes representing iRacing's IP ever transit our infrastructure. The user's files stay on the user's machine. This is categorically different from hosting extracted meshes.

### The one remaining wrinkle: DMCA anti-circumvention

Reading files from disk is fine. Rendering them is fine. The specific step of **decrypting** `.mdl` files is where we're technically circumventing a protection mechanism, and the DMCA has anti-circumvention provisions that apply regardless of whether distribution happens.

Two mitigations:

1. **Use a community-maintained decryption library rather than in-house code.** Integrating an established open-source reverser's work is a different posture than building proprietary decryption as a Pro Drive feature. We want to be a consumer of community tooling, not a developer of it.
2. **iRacing's historical tolerance.** Trading Paints, icarmap, and the broader paint ecosystem depend on mesh access of some form. If iRacing wanted to shut that down they could have years ago — they benefit from the community paint scene. Not a legal defense, but a risk signal.

## The Architecture

Two surfaces, shared code where it makes sense, split along what touches local iRacing files.

### Web app (closed repo `racecor-prodrive-server`, `apps/web/`) — 2D-only by design

Pure 2D paint editor. Works standalone without the overlay installed. Handles:

- **Paint project management** — create/open/save projects per car, per livery variant.
- **Template overlay editor.** Load the community paint template for the car (the layered PSD/PNG that maps TGA regions to car panels). Render the user's in-progress TGA over the template with panel outlines, seams, and UV boundaries visible as overlay guides. Solves "I can't see what this will look like wrapped" for the majority of cases.
- **Mirror-logo tool.** Pure 2D geometry. User places a logo at position P on the left panel; tool creates a horizontally-flipped copy at the mirrored UV coordinate on the right panel. Logo-order reversal is a group-level operation.
- **Precise placement primitives** — snap to panel edges, snap to UV seams, numeric position input, alignment guides across mirrored pairs.
- **Asset library** — sponsor logos, car numbers, flags, fonts. User uploads + repo-stock decals.
- **TGA export.** 24-bit, 2048×2048, in the format iRacing expects. Downloadable or (if overlay companion is installed) written directly to `Documents\iRacing\paint\<car>\`.

The web app alone ships real value — it addresses pain points 1, 2, and 4 without any mesh access.

### Electron overlay (`racecor-overlay/`) — adds the 3D preview

The overlay already reads the user's iRacing install for telemetry and already talks to SimHub. Extending it to read mesh data is the same pattern, not a new category of thing. Adds:

- **Local mesh reading.** A new `MeshReader` module in the Electron main process. Locates iRacing install via registry (`HKLM\SOFTWARE\iRacing\`) or path detection reusing existing SimHub/Pit House discovery logic. Reads `.mdl` files on demand when the user opens a paint project for a given car.
- **In-memory decryption via community library.** Decrypt in memory only. Never write decoded meshes to disk. Never include them in logs or crash reports. Explicitly scrub from any future analytics telemetry.
- **IPC bridge to the paint editor UI.** Parsed vertex/index buffers sent to the renderer over the existing IPC channel. Renderer caches in memory for the session.
- **three.js preview pane.** Real-time 3D preview with the current TGA applied as texture. Updates live as the user paints in the web editor. Sync is local only — localhost WebSocket or IPC between the overlay and any web editor instance running alongside it.
- **Auto-sync to iRacing paint folder.** Writes TGA to the correct directory on save. iRacing's own 3D Car Viewer still works as an authoritative backup preview.

The paint editor UI can be shared React code between the web app and an Electron BrowserWindow. The 3D canvas just doesn't mount in the web-only version because the mesh IPC isn't there.

## Why This Split Works

- **Legally defensible.** Mesh data never touches our infrastructure. If iRacing asks questions, the answer is "our desktop tool reads files the user already owns on their own machine. We don't distribute anything."
- **Web source stays flexible.** Whether we close the web source for business reasons or keep it open, it doesn't affect the mesh question because the web side never touches meshes.
- **Ships value incrementally.** Web app alone solves pain points 1, 2, and 4. Overlay adds pain point 3 and the visual polish of in-editor 3D preview.
- **Graceful degradation.** Users without the overlay installed still get 2D template overlay + mirror-logo + direct export. They can use iRacing's own Car Viewer for 3D inspection.
- **Leverages existing infrastructure.** The overlay already has path detection, IPC, settings persistence, and a renderer process. Mesh reading is an additive module, not a new architecture.

## Phased Approach

### Phase 1 — Web app 2D editor

- Paint project schema in Drizzle (project, car, layers, decals, fonts used)
- Template overlay renderer (canvas-based, handles common car templates)
- Mirror-logo tool with order-reversal for groups
- Asset library (user uploads + stock)
- TGA export (24-bit, 2048×2048, correct byte layout)
- Auth reuses existing Pro Drive Discord OAuth
- Storage: Vercel Blob for user-uploaded decals, Neon for project metadata

**Ship criterion:** a user can open a car template, place logos with mirror-pairing, export a TGA that drops into `iracing\paint\<car>\`, and see it correctly wrapped in iRacing's own 3D Car Viewer.

### Phase 2 — Electron overlay 3D preview

Now feasible from the start (previously gated on Phase 1 traction, but the Electron-local architecture makes this safe enough to pursue in parallel).

- `MeshReader` module in overlay main process with iRacing install detection
- Integrate a community-maintained `.mdl` decryption library (do not roll our own)
- IPC bridge sending parsed geometry to renderer
- three.js preview pane with TGA texture application
- Local sync between paint editor and preview (WebSocket on localhost, or shared BrowserWindow)
- Auto-sync paint file to iRacing's paint folder on save

**Ship criterion:** user has the overlay installed, opens a paint project, sees a 3D preview of their car updating in real time as they paint. Decoded mesh data never leaves the user's machine.

### Phase 3 — If paid-tier licensing becomes strategically interesting

Only if Phase 1/2 prove the market *and* we want to reduce DMCA exposure further:

- Approach iRacing business dev for licensed proxy meshes (low-poly, officially distributable under a partnership).
- Commission generic mesh shapes per car class (Formula, GT3, LMP, stock) that approximate UV layout without being iRacing assets.

Do not pursue server-hosted extracted meshes. Ever. Regardless of source visibility.

## Pieces Already in the Repo We Can Reuse

From the scoping pass:

- **Auth & session** — Discord OAuth in the closed `racecor-prodrive-server` repo's `apps/web/` is already wired up.
- **Persistence patterns** — Drizzle + Neon for project metadata follows existing patterns.
- **TokenEditor admin UI** — the existing theme/token editor in the closed `racecor-prodrive-server` repo's `apps/web/` is a decent reference for the kind of visual editor we'd build. Same React 19 + Tailwind 4 stack.
- **Vercel Blob storage** — already used for image uploads elsewhere in the closed `racecor-prodrive-server` repo's `apps/web/`.
- **Electron IPC & path detection** — the overlay already has main/renderer IPC, preload context bridge, settings persistence, and path detection logic for SimHub and Pit House. The `MeshReader` module slots into this existing pattern.

What we don't have (greenfield):

- No 3D rendering anywhere in the repo (three.js is new).
- No image/TGA manipulation libraries.
- No PSD parsing (needed if we want to consume community paint templates as-published).
- No `.mdl` decryption integration (will pull in a community library rather than write our own).

## Open Questions

- **Template sourcing.** Community paint templates are usually published as PSDs. Do we parse PSDs in-browser (`ag-psd` exists), or require curators to convert to a layered-PNG format we define? First approach is more user-friendly but PSD parsing is notoriously finicky.
- **Cars to support at launch.** All iRacing content is a massive undertaking. Start with the most-painted 10–15 cars? (Skip Barber, MX-5, GR86, GT3 field, LMP field?)
- **Decryption library selection.** Need to evaluate the maintained options, their licensing (we prefer permissive), and their compatibility with shipping inside an Electron binary.
- **Monetization.** Included in Pro Drive subscription, or separate tier? Likely included — it's a Pro Drive feature.
- **Collaboration.** Nice-to-have: shared team liveries, version history, comments. Explicit non-goal for Phase 1.

## Next Concrete Step

Sketch Phase 1 in more detail:

1. Data model (Drizzle schema for projects, layers, decals).
2. Route layout in `apps/web/src/app/` (closed `racecor-prodrive-server` repo) for the editor.
3. Canvas rendering approach for the template overlay.
4. Mirror-logo math — pin down the coordinate transform for UV-space mirroring with order reversal.
5. TGA export — validate the format against a known-good iRacing paint to make sure byte layout matches.

Then in parallel, spike Phase 2:

1. Path detection for iRacing install in the overlay main process.
2. Survey of community `.mdl` decryption libraries — license, maintenance status, API shape.
3. Prototype: read one `.mdl`, decrypt in memory, render the geometry to a three.js canvas in a new BrowserWindow. No texturing yet, just proof of concept that the pipeline works end-to-end on a real user's install.
