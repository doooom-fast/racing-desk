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
// The telemetry JSONL comes from the overlay's telemetry-sidecar.js
// (Phase 4 of the recording pipeline).
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { detectEvents } from './detect-events.js';
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

  // Use the most recent sidecar if multiple exist
  const sidecarFile = sidecarFiles.sort().pop();
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
        summary = obj;
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
  const sources = { cockpit: null, tvView: null, audio: [] };

  for (const vf of videoFiles) {
    const fullPath = join(dir, vf);
    const lower = vf.toLowerCase();

    if (lower.includes('replay') || lower.includes('tv') || lower.includes('broadcast')) {
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
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const durationSec = (lastFrame.t || 0) - (firstFrame.t || 0);

  const session = {
    version: 1,
    sidecarFile,
    frameCount: frames.length,
    durationSec: +durationSec.toFixed(1),
    durationStr: formatDuration(durationSec),
    fps: frames.length / Math.max(1, durationSec),
    startPosition: firstFrame.pos || 0,
    endPosition: lastFrame.pos || 0,
    totalCars: firstFrame.totalCars || 0,
    totalIncidents: lastFrame.incidents || 0,
    totalLaps: lastFrame.lap || 0,
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
