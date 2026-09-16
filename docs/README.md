# docs

Context that spans more than one app in this repo. Anything tied to a single app lives in that app's
`CLAUDE.md`.

| Doc | What it covers |
|-----|----------------|
| [local-first-refactor-plan.md](local-first-refactor-plan.md) | **The live plan.** Single-user, rig-local Pro Drive: two processes, no cloud, one repo, `.ibt`-derived track geometry, Race Now suggestions, the rig as the dev environment |
| [local-first-phase0-findings.md](local-first-phase0-findings.md) | Phase 0 rig discovery — track geometry from `.ibt`, install layout, telemetry history, schedule source; probes in [`phase0-probes/`](phase0-probes/) |
| [telemetry-sidecar-schema.md](telemetry-sidecar-schema.md) | Per-frame telemetry sidecar schema (`.telemetry.jsonl`) |
| [video-editor-plan.md](video-editor-plan.md) | Video editor and the `.rcpdv` bundle format — written for the multi-repo, native-apps world; the bundle format still applies |
| [obs-recording-mode-plan.md](obs-recording-mode-plan.md) | OBS recording mode — OBS owns video; a companion records the telemetry sidecar |

[`archive/`](archive/) holds docs superseded by the local-first plan (cloud hub, native-app API
contracts, the six-repo release pipeline). Kept for reference; don't build on them.
