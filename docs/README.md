# docs

Context that spans more than one app in this repo. Anything tied to a single app lives in that app's
`CLAUDE.md`.

| Doc | What it covers |
|-----|----------------|
| [local-first-refactor-plan.md](local-first-refactor-plan.md) | **The live plan.** Single-user, rig-local Racing Desk (written as Pro Drive, the old name): two processes, no cloud, one repo, `.ibt`-derived track geometry, Race Now suggestions, the rig as the dev environment |
| [local-first-phase0-findings.md](local-first-phase0-findings.md) | Phase 0 rig discovery — track geometry from `.ibt`, install layout, telemetry history, schedule source; probes in [`phase0-probes/`](phase0-probes/) |
| [race-join-findings.md](race-join-findings.md) | Listing/joining official sessions from inside the app — what the rig allows (`iracing://` deep links, the UI's local ports and hand-off, UI Automation), ranked options and the first slice for Race Now |
| [height-and-pedals-findings.md](height-and-pedals-findings.md) | Per-car driver height and Heusinkveld brake settings — where iRacing and SmartControl keep them, what can be restored and how, ranked options and first slices |
| [view-and-pedals-plan.md](view-and-pedals-plan.md) | **Plan** for the two per-car tools: the view (height, seat, horizon) and the pedals (profile and brake force) — design, slices, and the experiments that gate every write |
| [car-controls-findings.md](car-controls-findings.md) | In-car controls car by car — what each of the 55 cars driven publishes, what the garage calls it, where the telemetry misleads (ABS, traction control, brake bias, modes, GTP brake migration, DRS, push-to-pass), and why what a car has is a list written by hand |
| [telemetry-sidecar-schema.md](telemetry-sidecar-schema.md) | Per-frame telemetry sidecar schema (`.telemetry.jsonl`) |
| [video-editor-plan.md](video-editor-plan.md) | Video editor and the `.rcpdv` bundle format — written for the multi-repo, native-apps world; the bundle format still applies |
| [obs-recording-mode-plan.md](obs-recording-mode-plan.md) | OBS recording mode — OBS owns video; a companion records the telemetry sidecar |

[`archive/`](archive/) holds docs superseded by the local-first plan (cloud hub, native-app API
contracts, the six-repo release pipeline). Kept for reference; don't build on them.
