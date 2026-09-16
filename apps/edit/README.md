# prodrive-edit

AI-powered race editing pipeline — telemetry-driven camera switching and race condensing. Ingests `.mp4` race recordings + their `.telemetry.jsonl` sidecars, detects events, scores significance, generates an EDL (edit decision list) with optional Claude direction, and renders the final condensed video via ffmpeg.

A CLI tool. Not user-facing today; consumed by internal workflows + future overlay/desktop-app features.

## Where this fits

This pipeline consumes the **`.rcpdv` race-bundle** format produced by the [`prodrive-overlay`](https://github.com/k10-motorsports/prodrive-overlay) when recording is enabled. A bundle is a folder containing `video.mp4` + `telemetry.jsonl` + `metadata.json` — see the bundle/sidecar schemas in the [agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

```
prodrive-overlay → records → .rcpdv (mp4 + jsonl + meta)
                              │
                              ▼
                     prodrive-edit (this repo)
                              │
                              ▼
                     condensed/edited mp4
```

## Pipeline

```
src/ingest/
  parse-telemetry.js        Streaming JSONL parser for the .telemetry.jsonl sidecar
  detect-events.js          Identifies race events: incidents, position changes,
                            overtakes, fuel calls, pit windows, lap-time PBs

src/analyze/
  scoring-engine.js         Scores each event by significance (severity, rarity, context)
  silence-detect.js         Finds dead-air segments to cut around in condense mode
  edl-generator.js          Produces the EDL — the ordered list of (in, out, layer) cuts
  condenser.js              "Highlight reel" mode: keeps top-N events, trims everything else
  claude-director.js        Optional Claude pass: feeds the EDL into the Anthropic API
                            for narrative reordering and per-cut commentary
  prompts/                  Prompt templates for claude-director

src/render/
  ffmpeg-assembly.js        Reads the EDL, calls ffmpeg via fluent-ffmpeg to mux the cuts

src/utils/
  ffmpeg.js                 ffmpeg path resolution + probe helpers
  time.js                   Frame ↔ time conversions, lap-time formatting
```

## Tech stack

- **Node 20+** (ES modules)
- **fluent-ffmpeg** — wraps the system `ffmpeg` binary
- **@anthropic-ai/sdk** (optional) — only required if you use the `claude-director` step

## Install

Requires `ffmpeg` on your `$PATH`.

```bash
npm install
```

If you want the Claude direction step, set `ANTHROPIC_API_KEY` in your environment. Without it, the pipeline still produces an EDL — just without narrative reordering.

## Use

```bash
# Top-level entrypoint (planned bin script — not wired yet)
npm start -- <bundle-dir> [--mode=condense|highlight] [--out=path.mp4]
```

Today the steps are run individually as Node scripts; a unified `bin/racecor-edit.js` is the next step (referenced in `package.json:bin` but not yet present).

## Tests

```bash
npm test
```

Tests live in `tests/` (using Node's built-in test runner):

- `detect-events.test.js` — event-detection invariants
- `edl-generator.test.js` — EDL ordering + bounds
- `scoring-engine.test.js` — significance scoring shape
- `time.test.js` — frame/time conversion math

The fixtures under `tests/` use sample telemetry from [`prodrive-telemetry`](https://github.com/k10-motorsports/prodrive-telemetry) (a sibling repo of `.mp4` + `.telemetry.jsonl` pairs from real iRacing sessions).

## Cross-repo context

This repo is independent from the lockstep release set — ships on its own cadence. Canonical agent instructions live under [`agents/prodrive-edit/`](agents/prodrive-edit/) — pulled in via the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

To pull updates:

```bash
git submodule update --init --remote agents
```

Common entry points:
- Repo overview: [`agents/prodrive-edit/CLAUDE.md`](agents/prodrive-edit/CLAUDE.md)
- Cross-repo orchestration: [`agents/prodrive-context/`](agents/prodrive-context/)
- Telemetry sidecar schema: [`agents/prodrive-context/telemetry-sidecar-schema.md`](agents/prodrive-context/telemetry-sidecar-schema.md)
- Sibling overlay (the producer): [`prodrive-overlay`](https://github.com/k10-motorsports/prodrive-overlay)
- Sibling sample data: [`prodrive-telemetry`](https://github.com/k10-motorsports/prodrive-telemetry)

## License

Private. All rights reserved.
