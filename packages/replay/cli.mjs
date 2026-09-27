#!/usr/bin/env node
// prodrive-replay — record the plugin's live payload, play it back on the same contract.
//
//   record [--out <file>] [--hz 30] [--duration <s>] [--only-in-car] [--source <url>]
//   play   [<file>] [--port 8889] [--speed 1] [--seek mm:ss] [--paused] [--no-loop]
//   info   [<file>]
//   list
//
// <file> defaults to the newest recording in %LOCALAPPDATA%\RacingDesk\recordings.

import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readRecording, Player, EXTENSION } from './src/format.mjs';
import { record, inCar } from './src/record.mjs';
import { startReplayServer, CONTRACT_PATH } from './src/server.mjs';
import { attachTerminalControls, fmtTime } from './src/terminal.mjs';

export const RECORDINGS_DIR = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'RacingDesk', 'recordings');
const LIVE_URL = `http://localhost:8889${CONTRACT_PATH}`;

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) args[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

export const parseTime = (s) => {
  if (s === undefined) return 0;
  const parts = String(s).split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
};

export function listRecordings(dir = RECORDINGS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(EXTENSION))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs, bytes: statSync(join(dir, f)).size }))
    .sort((a, b) => b.mtime - a.mtime);
}

export function resolveRecording(arg) {
  if (arg) {
    if (/\.ibt$/i.test(arg)) throw new Error('.ibt playback needs the Phase 2 engine (core fed from .ibt) — record a live or demo session instead');
    return resolve(arg);
  }
  const newest = listRecordings()[0];
  if (!newest) throw new Error(`no recordings in ${RECORDINGS_DIR} — run "npm run record" while SimHub is serving (live session or demo mode)`);
  return newest.path;
}

async function cmdRecord(args) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = resolve(args.out ?? join(RECORDINGS_DIR, `${stamp}${EXTENSION}`));
  const ac = new AbortController();
  process.once('SIGINT', () => ac.abort());
  const url = args.source ?? LIVE_URL;
  console.log(`recording ${url} → ${out}${args['only-in-car'] ? ' (in-car frames only)' : ''} — Ctrl+C to stop`);
  let lastPrint = 0;
  const result = await record({
    url, out, hz: Number(args.hz ?? 30), durationSec: Number(args.duration ?? 0), onlyInCar: !!args['only-in-car'], signal: ac.signal,
    log: (m) => console.log(`  ${m}`),
    onFrame: ({ polled, written, skipped }) => {
      if (process.stdout.isTTY && performance.now() - lastPrint > 500) {
        lastPrint = performance.now();
        process.stdout.write(`\r  polled ${polled}  written ${written}  skipped ${skipped}   `);
      }
    },
  });
  if (process.stdout.isTTY) process.stdout.write('\n');
  console.log(`done: ${result.written} frames written from ${result.polled} polls in ${result.seconds.toFixed(1)}s → ${out}`);
}

async function cmdPlay(args) {
  const file = resolveRecording(args._[0]);
  const recording = readRecording(file);
  const replay = await startReplayServer({
    recording, port: Number(args.port ?? 8889), speed: Number(args.speed ?? 1), paused: !!args.paused,
    loop: !args['no-loop'], startMs: parseTime(args.seek), log: (m) => console.log(`  ${m}`),
  });
  console.log(`replaying ${file}`);
  console.log(`  ${recording.frames.length} frames, ${fmtTime(recording.duration)} — http://localhost:${replay.port}${CONTRACT_PATH}`);
  const quit = async () => { await replay.close(); process.exit(0); };
  if (!attachTerminalControls(replay, { onQuit: quit })) {
    process.once('SIGINT', quit);
  }
}

function cmdInfo(args) {
  const recording = readRecording(resolveRecording(args._[0]));
  const player = new Player(recording);
  const first = player.stateAt(0);
  let inCarFrames = 0;
  for (let i = 0; i < player.frames.length; i++) if (inCar(player.stateAt(i))) inCarFrames++;
  console.log(JSON.stringify({
    file: recording.path, header: recording.header, frames: recording.frames.length,
    keyframes: player.keyframes.length, duration: fmtTime(recording.duration), keys: Object.keys(first).length,
    inCarFrames, demoMode: Number(first['RacingDesk.Plugin.DemoMode']) === 1,
    track: first['DataCorePlugin.GameData.TrackName'] ?? first['RacingDesk.Plugin.Demo.TrackName'] ?? null,
  }, null, 2));
}

function cmdList() {
  const recs = listRecordings();
  if (!recs.length) return console.log(`no recordings in ${RECORDINGS_DIR}`);
  for (const r of recs) console.log(`${new Date(r.mtime).toISOString().slice(0, 16)}  ${(r.bytes / 1024).toFixed(0).padStart(7)} KB  ${r.path}`);
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const commands = { record: cmdRecord, play: cmdPlay, info: cmdInfo, list: cmdList };
  if (!commands[cmd]) {
    console.log('usage: prodrive-replay <record|play|info|list> [options] — see header of packages/replay/cli.mjs');
    process.exit(cmd ? 1 : 0);
  }
  Promise.resolve(commands[cmd](args)).catch((err) => { console.error(`error: ${err.message}`); process.exit(1); });
}
