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
    throw new Error('session.json not found. Run `racing-desk-edit ingest` first.');
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
export function buildMechanicalEDL(session, cameraSegments) {
  const cuts = cameraSegments.map(seg => ({
    start: formatDuration(seg.start),
    end: formatDuration(seg.end),
    source: seg.source,
    reason: seg.source === 'tv' ? 'High TV score (mechanical)' : 'Default cockpit',
  }));

  // Build a simple highlight reel from position changes and incidents: the first five moments, those that overlap
  // made one (a lap-one shuffle of four places is one stretch of the race, not four clips of it)
  const moments = session.events
    .filter(e => e.event === 'position_change' || e.event === 'incident' || e.event === 'close_battle')
    .map(e => ({ ...highlightWindow(e), label: highlightLabel(e) }))
    .sort((a, b) => a.from - b.from);
  const merged = [];
  for (const m of moments) {
    const last = merged[merged.length - 1];
    if (last && m.from <= last.to) {
      last.to = Math.max(last.to, m.to);
      last.labels.push(m.label);
    } else {
      merged.push({ from: m.from, to: m.to, labels: [m.label] });
    }
  }
  const highlights = merged.slice(0, 5).map(m => ({
    start: formatDuration(Math.max(0, m.from)),
    end: formatDuration(m.to),
    source: 'mixed',
    label: m.labels.join(', '),
  }));

  return {
    title: `Race Edit — P${session.startPosition} → P${session.endPosition}`,
    total_duration: session.durationStr,
    cuts,
    highlight_reel: { segments: highlights },
  };
}

/** The longest a battle's highlight runs: battles within 5 s of each other are one, and one can last minutes. */
const BATTLE_HIGHLIGHT_SEC = 20;

/** The stretch of the race a highlight shows, in seconds, 3 s either side of the moment. */
function highlightWindow(e) {
  if (e.event === 'close_battle' && Number.isFinite(e.data?.closestAt)) {
    // Around the closest moment of it, not the whole of it.
    const from = Math.max(e.t, e.data.closestAt - BATTLE_HIGHLIGHT_SEC / 2);
    const to = Math.min(e.t + (e.duration || 0), from + BATTLE_HIGHLIGHT_SEC);
    return { from: from - 3, to: Math.max(to, from + 5) + 3 };
  }
  return { from: e.t - 3, to: e.t + (e.duration || 5) + 3 };
}

function highlightLabel(e) {
  if (e.event === 'position_change') return `P${e.data.from} → P${e.data.to}`;
  if (e.event === 'close_battle') {
    return e.data.minGap < 0.1 ? 'Battle (gap under 0.1s)' : `Battle (gap ${e.data.minGap.toFixed(1)}s)`;
  }
  return `Incident (+${e.data?.added || '?'}x)`;
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
