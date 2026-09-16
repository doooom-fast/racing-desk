// ═══════════════════════════════════════════════════════════════
// CONDENSER — Smart-cut a race to a target duration
//
// The magic command: turn a 20-minute race into a 5-minute edit
// that only keeps the interesting parts.
//
// Pipeline:
//   1. Load session + telemetry
//   2. Score every second for interest
//   3. Detect audio silence (strongest "boring" signal)
//   4. Classify segments: KEEP / MAYBE / CUT
//   5. Adjust threshold to hit target duration
//   6. (Optional) Claude refines for narrative flow
//   7. FFmpeg renders the condensed edit
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scoreFrames } from './scoring-engine.js';
import { detectSilence } from './silence-detect.js';
import { refineCondensing, detectClaudeMode } from './claude-director.js';
import { renderEdit } from '../render/ffmpeg-assembly.js';
import { parseDuration, formatDuration } from '../utils/time.js';

// ── Thresholds ──────────────────────────────────────────────
const KEEP_THRESHOLD = 50;
const MAYBE_THRESHOLD = 25;
const MIN_SEGMENT_SEC = 3;       // don't create segments shorter than this
const BREATHING_ROOM_SEC = 2;    // pad around keep segments

/**
 * Condense a race to a target duration.
 * @param {string} dir - Session directory
 * @param {Object} opts - { target: "5:00", social: bool, ... }
 * @returns {Object} Condensing result
 */
export async function condense(dir, opts = {}) {
  const targetSec = parseDuration(opts.target || '5:00');

  // ── Load session ──────────────────────────────────────────
  const sessionPath = join(dir, 'session.json');
  if (!existsSync(sessionPath)) {
    throw new Error('session.json not found. Run `racecor-edit ingest` first.');
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));

  // ── Load telemetry ────────────────────────────────────────
  const sidecarPath = join(dir, session.sidecarFile);
  const raw = readFileSync(sidecarPath, 'utf8');
  const lines = raw.trim().split('\n');
  let skippedLines = 0;
  const frames = lines
    .map(line => {
      if (!line.trim()) return null;
      try {
        return JSON.parse(line);
      } catch {
        skippedLines++;
        return null;
      }
    })
    .filter(f => f && !f._type);

  // Warn if >5% of lines were skipped
  const totalParsedLines = frames.length + skippedLines;
  if (totalParsedLines > 0) {
    const skipPercentage = (skippedLines / totalParsedLines) * 100;
    if (skipPercentage > 5) {
      console.warn(
        `  Warning: ${skippedLines}/${totalParsedLines} lines (${skipPercentage.toFixed(1)}%) ` +
        `skipped during JSONL parsing in ${session.sidecarFile}. This may indicate corrupted telemetry.`
      );
    }
  }

  // ── Score every second ────────────────────────────────────
  console.log('  Scoring telemetry...');
  const scores = scoreFrames(frames, session.events);

  // ── Detect audio silence ──────────────────────────────────
  const cockpitPath = session.sources?.cockpit?.path;
  let silences = [];
  if (cockpitPath && existsSync(cockpitPath)) {
    console.log('  Detecting audio silence...');
    silences = detectSilence(cockpitPath, { noiseDb: -30, minDuration: 5 });
    console.log(`  Found ${silences.length} silent stretches`);

    // Apply silence penalty to interest scores
    for (const s of silences) {
      for (let sec = Math.floor(s.start); sec <= Math.ceil(s.end) && sec < scores.length; sec++) {
        if (scores[sec]) {
          scores[sec].interestScore = Math.max(0, scores[sec].interestScore - 25);
        }
      }
    }
  }

  // ── Classify segments ─────────────────────────────────────
  console.log('  Classifying segments...');
  let segments = classifySegments(scores, KEEP_THRESHOLD, MAYBE_THRESHOLD);

  // ── Adjust threshold to hit target duration ───────────────
  let keptDuration = calcKeptDuration(segments);
  let threshold = KEEP_THRESHOLD;

  if (keptDuration > targetSec) {
    // Too much kept — raise threshold
    while (keptDuration > targetSec && threshold < 90) {
      threshold += 5;
      segments = classifySegments(scores, threshold, threshold - 15);
      keptDuration = calcKeptDuration(segments);
    }
    console.log(`  Raised threshold to ${threshold} → ${formatDuration(keptDuration)} kept`);
  } else if (keptDuration < targetSec * 0.7) {
    // Too little kept — lower threshold
    while (keptDuration < targetSec * 0.9 && threshold > 10) {
      threshold -= 5;
      segments = classifySegments(scores, threshold, threshold - 15);
      keptDuration = calcKeptDuration(segments);
    }
    console.log(`  Lowered threshold to ${threshold} → ${formatDuration(keptDuration)} kept`);
  }

  // ── Claude refinement (if available) ──────────────────────
  let refinedSegments = segments;
  const claudeMode = detectClaudeMode();

  if (claudeMode) {
    console.log(`  Asking Claude to refine condensing (${claudeMode} mode)...`);
    try {
      const claudeResult = await refineCondensing(session, scores, segments, opts.target || '5:00');
      if (claudeResult && claudeResult.segments) {
        refinedSegments = claudeResult.segments.map(s => ({
          start: parseDuration(s.start),
          end: parseDuration(s.end),
          action: s.action,
          source: s.source || 'mixed',
          contextBridge: s.context_bridge || null,
          reason: s.reason || '',
        }));
        console.log(`  Claude refined: ${refinedSegments.length} segments`);
      }
    } catch (err) {
      console.warn(`  Claude refinement failed: ${err.message}`);
      console.log('  Using mechanical segments.');
    }
  }

  // ── Build condensed EDL ───────────────────────────────────
  const keptSegs = refinedSegments.filter(s => s.action === 'keep');
  const cutSegs = refinedSegments.filter(s => s.action === 'cut');
  const finalDuration = keptSegs.reduce((sum, s) => sum + (s.end - s.start), 0);

  const condensedEDL = {
    title: `Condensed: ${session.durationStr} → ${formatDuration(finalDuration)}`,
    total_duration: formatDuration(finalDuration),
    cuts: keptSegs.map(s => ({
      start: formatDuration(s.start),
      end: formatDuration(s.end),
      source: s.source || 'cockpit',
      reason: s.reason || 'Interest score above threshold',
    })),
  };

  // Save condensed EDL
  const condensedEdlPath = join(dir, 'condensed-decisions.json');
  writeFileSync(condensedEdlPath, JSON.stringify(condensedEDL, null, 2));

  // Also save as the main edit-decisions.json for the renderer
  writeFileSync(join(dir, 'edit-decisions.json'), JSON.stringify(condensedEDL, null, 2));

  // ── Render ────────────────────────────────────────────────
  console.log('  Rendering condensed edit...');
  const outputName = opts.output || `condensed-${opts.target?.replace(':', 'm') || '5m00'}.mp4`;
  const result = await renderEdit(dir, { ...opts, output: outputName });

  return {
    success: true,
    originalDuration: session.durationStr,
    finalDuration: formatDuration(finalDuration),
    keptSegments: keptSegs.length,
    cutSegments: cutSegs.length,
    threshold,
    outputPath: result.outputPath,
  };
}

/**
 * Classify seconds into segments based on interest score.
 */
function classifySegments(scores, keepThreshold, maybeThreshold) {
  const segments = [];
  let currentAction = null;
  let segmentStart = 0;
  let segmentScores = [];

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    let action;
    if (s.interestScore >= keepThreshold) action = 'keep';
    else if (s.interestScore >= maybeThreshold) action = 'maybe';
    else action = 'cut';

    if (action !== currentAction && currentAction !== null) {
      // Guard against division by zero
      const avgInterest = segmentScores.length > 0
        ? segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length
        : 0;
      segments.push({
        start: segmentStart,
        end: s.t,
        action: currentAction === 'maybe' ? 'cut' : currentAction, // collapse maybe → cut
        avgInterest,
      });
      segmentStart = s.t;
      segmentScores = [];
    }

    currentAction = action;
    segmentScores.push(s.interestScore);
  }

  // Close final segment
  if (currentAction !== null && scores.length > 0) {
    // Guard against division by zero
    const avgInterest = segmentScores.length > 0
      ? segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length
      : 0;
    segments.push({
      start: segmentStart,
      end: scores[scores.length - 1].t,
      action: currentAction === 'maybe' ? 'cut' : currentAction,
      avgInterest,
    });
  }

  // Merge short segments and add breathing room
  return mergeShortSegments(segments);
}

function mergeShortSegments(segments) {
  const merged = [];
  for (const seg of segments) {
    const duration = seg.end - seg.start;
    if (duration < MIN_SEGMENT_SEC && merged.length > 0) {
      // Absorb into the previous segment
      merged[merged.length - 1].end = seg.end;
    } else {
      // Add breathing room around keep segments
      if (seg.action === 'keep') {
        seg.start = Math.max(0, seg.start - BREATHING_ROOM_SEC);
        seg.end = seg.end + BREATHING_ROOM_SEC;
      }
      merged.push({ ...seg });
    }
  }
  return merged;
}

function calcKeptDuration(segments) {
  return segments
    .filter(s => s.action === 'keep')
    .reduce((sum, s) => sum + (s.end - s.start), 0);
}

