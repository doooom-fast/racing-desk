# prodrive-edit

AI-powered race editing pipeline — telemetry-driven camera switching and race condensing. Ingests `.mp4` race recordings + their `.telemetry.jsonl` sidecars, detects events, scores significance, generates an EDL (edit decision list) with optional Claude direction, and renders the final condensed video via ffmpeg.

A CLI tool. Not user-facing today; consumed by internal workflows + future overlay/desktop-app features.

## Where this fits

This pipeline reads the folder Racing Desk files each OBS recording in (`docs/recording.md`): the `.mp4` OBS wrote, its `.telemetry.jsonl` sidecar, the replay clips (`Replay …`) and the TV take (`… tv.mp4`) of that session. The `.rcpdv` bundle is gone. The sidecar's shape is in [`docs/telemetry-sidecar-schema.md`](../../docs/telemetry-sidecar-schema.md).

```
OBS records, Racing Desk files → <date track car>\ (mp4 + telemetry.jsonl + clips + tv)
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
  video-time.js             The sidecar's t ↔ the video's own time (offset, pauses)

bin/
  racing-desk-edit.js       The command line: ingest, analyze, preview, render, condense, clips
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
node bin/racing-desk-edit.js --help
node bin/racing-desk-edit.js ingest "D:\Racing Desk\Recordings\<date track car>"
node bin/racing-desk-edit.js analyze <dir> [--no-claude]
node bin/racing-desk-edit.js render <dir> [--dry-run] [--resolution 720] [--output edit.mp4]
node bin/racing-desk-edit.js condense <dir> --target 5:00
node bin/racing-desk-edit.js clips <dir> [--social]
```

Cuts are worked out in the telemetry's time and cut from the video at the moment it shows them: the sidecar's
`videoOffsetMs`, less any pauses (`src/utils/video-time.js`; [`CLAUDE.md`](CLAUDE.md), Telemetry time and video time).

## Tests

```bash
npm test
```

Tests live in `tests/` (using Node's built-in test runner):

- `detect-events.test.js` — event-detection invariants
- `edl-generator.test.js` — EDL ordering + bounds
- `scoring-engine.test.js` — significance scoring shape
- `time.test.js` — frame/time conversion math
- `video-time.test.js` — telemetry time ↔ video time (offset, pauses, held to the file)
- `render-plan.test.js` — the EDL's cuts as stretches of the video
- `cli.test.js` — the commands over a made-up recording's folder
- `render-timing.test.js` — a real cut through ffmpeg lands on the telemetry's moment (skipped without ffmpeg)

The fixtures under `tests/` use sample telemetry from [`prodrive-telemetry`](https://github.com/DOOOOM/prodrive-telemetry) (a sibling repo of `.mp4` + `.telemetry.jsonl` pairs from real iRacing sessions).

## Context

Part of the `prodrive` monorepo. Agent instructions: [`CLAUDE.md`](CLAUDE.md). Shared docs:
[`docs/`](../../docs/) — notably the [telemetry sidecar schema](../../docs/telemetry-sidecar-schema.md).
The overlay that produces bundles is [`apps/overlay`](../overlay/).

## License

Private. All rights reserved.
