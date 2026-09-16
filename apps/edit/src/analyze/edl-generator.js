// ═══════════════════════════════════════════════════════════════
// EDL GENERATOR — Merge scoring engine + Claude → final edit plan
//
// Orchestrates the analysis pipeline:
//   1. Load session.json (from ingest)
//   2. Load telemetry frames
//   3. Score every second (TV + Interest)
//   4. Apply hysteresis → mechanical camera segments
//   5. (Optional) Claude refines editorial decisions
//   6. Output: edit-decisions.json
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scoreFrames, applyCameraHysteresis } from './scoring-engine.js';
import { refineCameraSwitching, detectClaudeMode } from './claude-director.js';
import { formatDuration } from '../utils/time.js';

/**
 * Analyze a session and produce edit decisions.
 * @param {string} dir - Session directory (must contain session.json)
 * @param {Object} [opts] - Options
 * @returns {Object} Edit decision list
 */
export async function analyze(dir, opts = {}) {
  // ── Load session ──────────────────────────────────────────
  const sessionPath = join(dir, 'session.json');
  if (!existsSync(sessionPath)) {
    throw new Error('session.json not found. Run `racecor-edit ingest` first.');
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));

  // ── Load telemetry frames ─────────────────────────────────
  const sidecarPath = join(dir, session.sidecarFile);
  if (!existsSync(sidecarPath)) {
    throw new Error(`Sidecar file not found: ${session.sidecarFile}`);
  }
  const raw = readFileSync(sidecarPath, 'utf8');
  const frames = raw.trim().split('\n')
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(f => f && !f._type);

  // ── Score every second ────────────────────────────────────
  console.log('  Scoring telemetry frames...');
  const scores = scoreFrames(frames, session.events);
  console.log(`  Scored ${scores.length} seconds`);

  // ── Mechanical camera switching ───────────────────────────
  const cameraSegments = applyCameraHysteresis(scores);
  console.log(`  Mechanical cuts: ${cameraSegments.length} segments`);

  // ── Claude refinement (if available) ───────────────────────
  let edl;
  const claudeMode = detectClaudeMode();

  if (claudeMode) {
    console.log(`  Asking Claude to refine edit decisions (${claudeMode} mode)...`);
    try {
      edl = await refineCameraSwitching(session, scores, cameraSegments);
      console.log(`  Claude refined: ${edl.cuts?.length || 0} cuts`);
    } catch (err) {
      console.warn(`  Claude error: ${err.message}`);
      console.log('  Falling back to mechanical edit decisions.');
      edl = buildMechanicalEDL(session, cameraSegments);
    }
  } else {
    console.log('  No Claude available — using mechanical edit decisions.');
    console.log('  (Install `claude` CLI or set ANTHROPIC_API_KEY for AI refinement)');
    edl = buildMechanicalEDL(session, cameraSegments);
  }

  // ── Annotate with scores ──────────────────────────────────
  edl.scores = {
    tvScoreAvg: avg(scores.map(s => s.tvScore)),
    interestScoreAvg: avg(scores.map(s => s.interestScore)),
    tvViewPercent: calcTVPercent(cameraSegments, session.durationSec),
  };

  // ── Save ──────────────────────────────────────────────────
  const outputPath = join(dir, 'edit-decisions.json');
  writeFileSync(outputPath, JSON.stringify(edl, null, 2));
  edl.outputPath = outputPath;

  return edl;
}

/**
 * Build an EDL from pure mechanical scoring (no Claude).
 */
function buildMechanicalEDL(session, cameraSegments) {
  const cuts = cameraSegments.map(seg => ({
    start: formatDuration(seg.start),
    end: formatDuration(seg.end),
    source: seg.source,
    reason: seg.source === 'tv' ? 'High TV score (mechanical)' : 'Default cockpit',
  }));

  // Build a simple highlight reel from position changes and incidents
  const highlights = session.events
    .filter(e => e.event === 'position_change' || e.event === 'incident' || e.event === 'close_battle')
    .slice(0, 5)
    .map(e => ({
      start: formatDuration(Math.max(0, e.t - 3)),
      end: formatDuration(e.t + (e.duration || 5) + 3),
      source: 'mixed',
      label: e.event === 'position_change'
        ? `P${e.data.from} → P${e.data.to}`
        : e.event === 'close_battle'
        ? `Battle (gap ${e.data.minGap}s)`
        : `Incident (+${e.data?.added || '?'}x)`,
    }));

  return {
    title: `Race Edit — P${session.startPosition} → P${session.endPosition}`,
    total_duration: session.durationStr,
    cuts,
    highlight_reel: { segments: highlights },
  };
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
}

function calcTVPercent(segments, totalSec) {
  if (totalSec <= 0) return 0;
  const tvSec = segments
    .filter(s => s.source === 'tv')
    .reduce((sum, s) => sum + (s.end - s.start), 0);
  return +((tvSec / totalSec) * 100).toFixed(1);
}
