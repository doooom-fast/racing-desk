#!/usr/bin/env node
// npm run dev [-- <recording>] [--live] [--speed 2] [--seek mm:ss] [--port 18889] [--devtools]
//
// Default: replays the newest recording on :18889 and starts the overlay in dev mode pointed at it,
// so SimHub can keep :8889. --live skips replay and points the overlay at SimHub's :8889.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readRecording, startReplayServer, attachTerminalControls, fmtTime, CONTRACT_PATH } from '../packages/replay/src/index.mjs';
import { parseArgs, parseTime, resolveRecording } from '../packages/replay/cli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const args = parseArgs(process.argv.slice(2));

let replay = null;
const overlayArgs = ['.', '--dev'];
if (args.devtools) overlayArgs.push('--devtools');

try {
  if (args.live) {
    console.log('overlay → live SimHub on :8889');
  } else {
    const file = resolveRecording(args._[0]);
    const recording = readRecording(file);
    replay = await startReplayServer({
      recording, port: Number(args.port ?? 18889), speed: Number(args.speed ?? 1), startMs: parseTime(args.seek),
      log: (m) => console.log(`\n  ${m}`),
    });
    overlayArgs.push(`--replay-port=${replay.port}`);
    console.log(`replaying ${file}`);
    console.log(`  ${recording.frames.length} frames, ${fmtTime(recording.duration)} on http://localhost:${replay.port}${CONTRACT_PATH}`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

const child = spawn(electron, overlayArgs, { cwd: join(root, 'apps', 'overlay'), stdio: ['ignore', 'inherit', 'inherit'] });
const shutdown = async (code = 0) => {
  if (!child.killed && child.exitCode === null) child.kill();
  if (replay) await replay.close();
  process.exit(code);
};
child.on('exit', (code) => shutdown(code ?? 0));
process.once('SIGINT', () => shutdown(0));
if (replay) attachTerminalControls(replay, { onQuit: () => shutdown(0) });
