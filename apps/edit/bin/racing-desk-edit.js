#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// RACING DESK EDIT — the command line
//
//   racing-desk-edit <command> <dir> [options]
//
// <dir> is a recording's folder as Racing Desk files it (the video
// OBS wrote, its .telemetry.jsonl, the replay clips and the TV take:
// docs/recording.md). Each command writes beside them: session.json,
// edit-decisions.json, the rendered .mp4 files.
// ═══════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ingest } from '../src/ingest/parse-telemetry.js';
import { analyze } from '../src/analyze/edl-generator.js';
import { condense } from '../src/analyze/condenser.js';
import { renderEdit, renderClips } from '../src/render/ffmpeg-assembly.js';
import { videoClock, describeClock } from '../src/utils/video-time.js';

const USAGE = `Usage: racing-desk-edit <command> <dir> [options]

Commands:
  ingest <dir>                 Read the telemetry, find the events → session.json
  analyze <dir>                Score every second (+ Claude if there is one) → edit-decisions.json
  preview <dir>                A low-resolution draft of the edit, each cut with its timecodes
  render <dir>                 The edit at full resolution
  condense <dir>               Cut the race down to --target and render it
  clips <dir>                  Each highlight of the edit as a clip of its own

Options:
  --target <m:ss>              condense: how long the cut-down race is (default 5:00)
  --output <file>              render, preview, condense: the file to write (in <dir> unless a path)
  --resolution <480|720|1080|4k>   render: default 1080
  --quality <draft|final>      render: default final
  --social                     render, condense, clips: a 9:16 copy of each as well
  --dry-run                    preview, render, condense, clips: list the cuts in the video's time, render nothing
  --no-claude                  analyze, condense: the mechanical edit only, without asking Claude
  -h, --help                   This

analyze and condense read the telemetry first when there is no session.json yet.
Cuts are worked out in the telemetry's time and cut from the video at the moment it shows them:
the sidecar's videoOffsetMs, less any pauses (docs/telemetry-sidecar-schema.md).`;

const OPTIONS = {
  target: { type: 'string' },
  output: { type: 'string' },
  resolution: { type: 'string' },
  quality: { type: 'string' },
  social: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-claude': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const COMMANDS = {
  async ingest(dir) {
    const session = await ingest(dir);
    console.log(`  ${session.sidecarFile}: ${session.frameCount} frames, ${session.durationStr}, P${session.startPosition} → P${session.endPosition}`);
    const events = Object.entries(session.eventSummary).map(([name, n]) => `${name} ${n}`).join(', ');
    console.log(`  Events: ${events || 'none'}`);
    const s = session.sources;
    console.log(`  Cockpit: ${s.cockpit ? `${s.cockpit.file} (${s.cockpit.durationStr})` : 'none'}`);
    if (s.tvView) console.log(`  TV: ${s.tvView.file} (${s.tvView.durationStr})`);
    if (s.clips.length) console.log(`  Replay clips: ${s.clips.length}`);
    console.log('  ' + describeClock(videoClock(session.sidecarSummary)));
    console.log(`  ✓ ${session.outputPath}`);
  },

  async analyze(dir) {
    await ingestIfNeeded(dir);
    const edl = await analyze(dir);
    console.log(`  ${edl.cuts?.length || 0} cuts, ${edl.highlight_reel?.segments?.length || 0} highlights, TV view ${edl.scores.tvViewPercent}%`);
    console.log(`  ✓ ${edl.outputPath}`);
  },

  async preview(dir, opts) {
    await renderEdit(dir, { quality: 'draft', resolution: '480', output: opts.output || 'edit-preview.mp4', dryRun: opts['dry-run'] });
  },

  async render(dir, opts) {
    await renderEdit(dir, {
      quality: opts.quality, resolution: opts.resolution, output: opts.output,
      social: opts.social, dryRun: opts['dry-run'],
    });
  },

  async condense(dir, opts) {
    await ingestIfNeeded(dir);
    const result = await condense(dir, {
      target: opts.target, output: opts.output, social: opts.social, dryRun: opts['dry-run'],
    });
    console.log(`  ${result.originalDuration} → ${result.finalDuration}: ${result.keptSegments} kept, threshold ${result.threshold}`);
  },

  async clips(dir, opts) {
    const result = await renderClips(dir, { social: opts.social, dryRun: opts['dry-run'] });
    if (result.clips.length) console.log(`  ✓ ${result.clips.length} clips`);
  },
};

async function ingestIfNeeded(dir) {
  if (existsSync(join(dir, 'session.json'))) return;
  console.log('  No session.json yet: reading the telemetry first.');
  await COMMANDS.ingest(dir);
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    console.error(err.message + '\n\n' + USAGE);
    return 2;
  }
  const { values: opts, positionals } = parsed;
  if (opts.help || positionals.length === 0) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }

  const [command, dirArg, ...extra] = positionals;
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error(`Not a command: ${command}\n\n${USAGE}`);
    return 2;
  }
  if (!dirArg || extra.length) {
    console.error(`${command} takes one folder.\n\n${USAGE}`);
    return 2;
  }
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Not a folder: ${dir}`);
    return 2;
  }
  if (opts['no-claude']) process.env.RACECOR_CLAUDE_MODE = 'none';

  try {
    await COMMANDS[command](dir, opts);
    return 0;
  } catch (err) {
    console.error(`  ${command} failed: ${err.message}`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
