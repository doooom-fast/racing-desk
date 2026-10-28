// ═══════════════════════════════════════════════════════════════
// PARSE TELEMETRY — Ingest a race session directory
//
// Reads:
//   • *.telemetry.jsonl  — per-frame telemetry sidecar
//   • *.mp4 / *.webm     — video files (cockpit + TV-view)
//   • *.aac / *.m4a      — separate audio tracks (if any)
//
// Outputs:
//   • session.json — metadata, event stream, source file inventory
//
// The telemetry JSONL comes from the overlay's telemetry-sidecar.js,
// written by Racing Desk beside the file OBS records (docs/recording.md):
// one folder per recording holds the video, its sidecar, and the
// replay clips ("Replay …", each with a sidecar of its own) and the TV
// take ("… tv.mp4") of that session. The recording's own sidecar is the
// one read; a clip's is read only when there is no other.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { detectEvents } from './detect-events.js';
import { knownPosition, finishTime, FINISH_HOLD_SEC } from './frame-values.js';
import { probe } from '../utils/ffmpeg.js';
import { formatDuration } from '../utils/time.js';

/**
 * Ingest a race session directory.
 * @param {string} dir - Path to the session directory
 * @param {Object} [opts] - Options
 * @returns {Object} Session metadata + event stream
 */
export async function ingest(dir, opts = {}) {
  // ── Find files ────────────────────────────────────────────
  const files = readdirSync(dir);
  const sidecarFiles = files.filter(f => f.endsWith('.telemetry.jsonl'));
  const videoFiles = files.filter(f => /\.(mp4|webm|mkv)$/i.test(f));
  const audioFiles = files.filter(f => /\.(aac|m4a|wav|mp3)$/i.test(f));

  if (sidecarFiles.length === 0) {
    throw new Error('No telemetry sidecar (.telemetry.jsonl) found in ' + dir);
  }

  // The recording's own sidecar, not a replay clip's or the TV take's, when there is one; else the most recent.
  const mainSidecars = sidecarFiles.filter((f) => !isClipName(f) && !isTvName(f));
  const sidecarFile = (mainSidecars.length ? mainSidecars : sidecarFiles).sort().pop();
  const sidecarPath = join(dir, sidecarFile);

  // ── Parse JSONL ───────────────────────────────────────────
  const raw = readFileSync(sidecarPath, 'utf8');
  const lines = raw.trim().split('\n');
  const frames = [];
  let summary = null;
  let skippedLines = 0;

  for (const line of lines) {
    if (!line.trim()) continue;  // skip empty lines
    try {
      const obj = JSON.parse(line);
      if (obj._type === 'summary') {
        summary = obj;          // the last one is the file's (a resumed recording has more than one)
      } else if (obj._type) {
        // The header, a resumed line: not frames. (The header used to be pushed as frame 0.)
        continue;
      } else {
        frames.push(obj);
      }
    } catch {
      skippedLines++;
    }
  }

  // Warn if >5% of lines were skipped
  const totalParsedLines = frames.length + (summary ? 1 : 0) + skippedLines;
  if (totalParsedLines > 0) {
    const skipPercentage = (skippedLines / totalParsedLines) * 100;
    if (skipPercentage > 5) {
      console.warn(
        `  Warning: ${skippedLines}/${totalParsedLines} lines (${skipPercentage.toFixed(1)}%) ` +
        `skipped during JSONL parsing in ${sidecarFile}. This may indicate corrupted telemetry.`
      );
    }
  }

  if (frames.length === 0) {
    throw new Error('No telemetry frames found in ' + sidecarFile);
  }

  // ── Detect events ─────────────────────────────────────────
  const events = detectEvents(frames);

  // ── Classify video sources ────────────────────────────────
  // Replay clips are not the TV view: they are the instant replays saved during the recording.
  const sources = { cockpit: null, tvView: null, clips: [], audio: [] };

  for (const vf of videoFiles) {
    const fullPath = join(dir, vf);
    const lower = vf.toLowerCase();

    if (isClipName(vf)) {
      sources.clips.push({ file: vf, path: fullPath });
    } else if (isTvName(vf) || lower.includes('broadcast')) {
      sources.tvView = { file: vf, path: fullPath };
    } else if (!sources.cockpit) {
      sources.cockpit = { file: vf, path: fullPath };
    } else if (!sources.tvView) {
      // Second video file defaults to TV view
      sources.tvView = { file: vf, path: fullPath };
    }
  }

  // Probe video durations
  for (const key of ['cockpit', 'tvView']) {
    if (sources[key]) {
      try {
        const info = probe(sources[key].path);
        const duration = parseFloat(info?.format?.duration || '0');
        sources[key].duration = duration;
        sources[key].durationStr = formatDuration(duration);
      } catch {
        sources[key].duration = 0;
        sources[key].durationStr = '?';
      }
    }
  }

  for (const af of audioFiles) {
    sources.audio.push({ file: af, path: join(dir, af) });
  }

  // ── Build session metadata ────────────────────────────────
  // The race's numbers are read from the race: up to his chequered flag and the moment after it, not from the last
  // frame of the file, which is the cool-down or the menus (a position of -1, lap 1 of the next session).
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const durationSec = (lastFrame.t || 0) - (firstFrame.t || 0);
  const finishedAt = finishTime(frames);
  const race = finishedAt === null ? frames : frames.filter((f) => (f.t || 0) <= finishedAt + FINISH_HOLD_SEC);
  const positions = race.map((f) => knownPosition(f.pos)).filter((p) => p !== null);
  const most = (key) => race.reduce((m, f) => (Number.isFinite(f[key]) && f[key] > m ? f[key] : m), 0);

  const session = {
    version: 1,
    sidecarFile,
    frameCount: frames.length,
    durationSec: +durationSec.toFixed(1),
    durationStr: formatDuration(durationSec),
    fps: frames.length / Math.max(1, durationSec),
    startPosition: positions[0] ?? 0,
    endPosition: positions[positions.length - 1] ?? 0,
    totalCars: most('totalCars'),
    totalIncidents: most('incidents'),
    // The lap he took the flag on (the counter goes on to the next a few seconds after it), else the last he reached.
    totalLaps: finishedAt === null ? most('lap') : (frames.find((f) => f.endOfRace).lap || most('lap')),
    finishedAt,
    sources,
    events,
    eventSummary: summarizeEvents(events),
    sidecarSummary: summary,
    outputPath: join(dir, 'session.json'),
  };

  // ── Write session.json ────────────────────────────────────
  writeFileSync(session.outputPath, JSON.stringify(session, null, 2));
  return session;
}

/** A replay clip saved by OBS's replay buffer: "Replay 2026-09-30 21-20-05.mp4" (and its sidecar). */
export function isClipName(name) {
  return /^replay\b/i.test(basename(String(name)));
}

/** The TV take: "… tv.mp4" (and its sidecar), as the replay director names it. */
export function isTvName(name) {
  return /\btv(\.telemetry)?\.[a-z0-9]+$/i.test(basename(String(name)));
}

/**
 * Summarize events for display.
 */
function summarizeEvents(events) {
  const counts = {};
  for (const e of events) {
    counts[e.event] = (counts[e.event] || 0) + 1;
  }
  return counts;
}
