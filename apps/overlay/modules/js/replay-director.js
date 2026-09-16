// ═══════════════════════════════════════════════════════════════
// REPLAY DIRECTOR — Phase 5: Automated iRacing replay recording
//
// Main-process module. After a race ends, reads the telemetry
// sidecar (.telemetry.jsonl) to identify TV-view moments, then
// automates iRacing's replay system to record broadcast-camera
// footage of each moment. Zero manual scrubbing.
//
// Architecture:
//   1. Parse sidecar markers → build moment list
//   2. Open iRacing replay (keystrokes)
//   3. Switch to broadcast/TV camera
//   4. Start recording (reuses existing pipeline)
//   5. For each moment: jump → settle → play through → next
//   6. Stop recording, notify renderer
//
// One continuous recording with jumps between moments. The editing
// pipeline already knows timestamps and trims fast-forward gaps.
//
// iRacing replay keyboard commands:
//   Numpad 5      — Pause/play replay
//   Numpad 4/6    — Frame back/forward
//   Shift+Numpad4 — Rewind
//   Shift+Numpad6 — Fast-forward
//   Numpad 7      — Jump to start
//   Numpad 8/2    — Previous/next car
//   Ctrl+F12      — Cycle camera groups
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const keyboardSender = require('./keyboard-sender');

// ── Constants ───────────────────────────────────────────────
const LEAD_IN_SEC = 3;        // seconds before each moment
const TAIL_SEC = 3;           // seconds after each moment
const SETTLE_MS = 1500;       // wait after jumping for camera to stabilize
const FF_SPEED_RATIO = 8;     // approximate fast-forward speed multiplier
const MIN_MOMENT_GAP_SEC = 5; // merge moments closer than this

// ── State ───────────────────────────────────────────────────
let _running = false;
let _cancelled = false;
let _currentMoment = 0;
let _totalMoments = 0;
let _progressCallback = null;  // (progress) => void — forwarded to renderer

// ── Parse sidecar file → moment list ────────────────────────
// Reads the .telemetry.jsonl, extracts interesting moments from
// the summary markers, deduplicates, and returns sorted list.

function parseSidecar(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) {
    throw new Error('Sidecar file not found: ' + sidecarPath);
  }

  const content = fs.readFileSync(sidecarPath, 'utf8');
  const lines = content.trim().split('\n');
  const moments = [];
  let summary = null;

  // Find the summary line (last line, has _type: 'summary')
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj._type === 'summary' && obj.markers) {
        summary = obj;
        break;
      }
    } catch (e) { /* skip malformed lines */ }
  }

  if (!summary || !summary.markers || summary.markers.length === 0) {
    return [];
  }

  // Extract TV-view-worthy moments
  for (const marker of summary.markers) {
    let priority = 0;
    let label = '';

    switch (marker.type) {
      case 'position_change':
        if (marker.direction === 'gained') {
          priority = 3;  // overtakes are high-priority TV moments
          label = 'Overtake P' + marker.from + ' → P' + marker.to;
        } else {
          priority = 1;  // lost positions still worth showing
          label = 'Lost position P' + marker.from + ' → P' + marker.to;
        }
        break;

      case 'incident':
        priority = 2;  // incidents are interesting but may be minor
        label = 'Incident (x' + (marker.to - marker.from) + ')';
        break;

      case 'pit_entry':
        priority = 1;
        label = 'Pit entry';
        break;

      case 'pit_exit':
        priority = 1;
        label = 'Pit exit';
        break;

      default:
        continue;  // skip new_lap etc.
    }

    moments.push({
      timeSec: (marker.t || 0) / 1000,  // convert ms to seconds
      endTimeSec: (marker.t || 0) / 1000,  // default: point-in-time moment
      frame: marker.frame || 0,
      type: marker.type,
      priority: priority,
      label: label,
    });
  }

  // Sort by time
  moments.sort(function (a, b) { return a.timeSec - b.timeSec; });

  // Merge moments that are closer than MIN_MOMENT_GAP_SEC
  return mergeMoments(moments);
}

function mergeMoments(moments) {
  if (moments.length <= 1) return moments;

  const merged = [moments[0]];
  for (let i = 1; i < moments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = moments[i];

    if (curr.timeSec - prev.timeSec < MIN_MOMENT_GAP_SEC) {
      // Merge: extend the previous moment's window, keep higher priority
      prev.priority = Math.max(prev.priority, curr.priority);
      prev.label += ' + ' + curr.label;
      // Extend the end time (we'll add TAIL_SEC later)
      prev.endTimeSec = curr.timeSec;
    } else {
      merged.push(Object.assign({}, curr));
    }
  }
  return merged;
}

// ── Estimate total recording time ───────────────────────────
function estimateTime(moments) {
  if (moments.length === 0) return 0;

  let totalSec = 0;
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const momentDuration = (m.endTimeSec || m.timeSec) - m.timeSec + LEAD_IN_SEC + TAIL_SEC;
    totalSec += momentDuration;

    // Add fast-forward time between moments
    if (i > 0) {
      const gap = m.timeSec - (moments[i - 1].endTimeSec || moments[i - 1].timeSec);
      if (gap > TAIL_SEC + LEAD_IN_SEC) {
        totalSec += (gap - TAIL_SEC - LEAD_IN_SEC) / FF_SPEED_RATIO;
        totalSec += SETTLE_MS / 1000;  // settle time after each jump
      }
    }
  }

  return Math.ceil(totalSec);
}

// ── Run the replay director ─────────────────────────────────
// sidecarPath: path to the .telemetry.jsonl
// options: { onProgress(progress) }
// Returns a promise that resolves when all moments are recorded.

async function run(sidecarPath, options) {
  if (_running) {
    throw new Error('Replay director is already running');
  }

  options = options || {};
  _progressCallback = options.onProgress || null;
  _running = true;
  _cancelled = false;

  try {
    // 1. Parse sidecar
    const moments = parseSidecar(sidecarPath);
    if (moments.length === 0) {
      emitProgress({ status: 'no_moments', message: 'No TV-view moments found in sidecar' });
      return { success: true, moments: 0, message: 'No moments to record' };
    }

    _totalMoments = moments.length;
    _currentMoment = 0;

    const estimatedSec = estimateTime(moments);
    emitProgress({
      status: 'starting',
      totalMoments: moments.length,
      estimatedSeconds: estimatedSec,
      message: moments.length + ' moments, ~' + formatTime(estimatedSec) + ' to record',
    });

    // 2. Enter replay mode
    await enterReplay();
    if (_cancelled) return cancelResult();

    // 3. Switch to broadcast/TV camera
    await switchToTVCamera();
    if (_cancelled) return cancelResult();

    // 4. Jump to start of replay
    await keyboardSender.sendKey('numpad7');  // jump to beginning
    await keyboardSender.sleep(1000);

    // 5. Notify renderer to start recording
    emitProgress({ status: 'recording_start' });
    // (The renderer handles actual MediaRecorder start via IPC)

    // 6. Process each moment
    for (let i = 0; i < moments.length; i++) {
      if (_cancelled) break;

      _currentMoment = i + 1;
      const m = moments[i];
      const targetSec = Math.max(0, m.timeSec - LEAD_IN_SEC);

      emitProgress({
        status: 'moment',
        current: _currentMoment,
        total: _totalMoments,
        label: m.label,
        timeSec: m.timeSec,
        message: 'Moment ' + _currentMoment + '/' + _totalMoments + ': ' + m.label,
      });

      // Fast-forward to the target time
      if (i === 0) {
        // First moment: fast-forward from start
        await fastForwardTo(targetSec, 0);
      } else {
        // Subsequent moments: fast-forward from previous position
        const prevEnd = (moments[i - 1].endTimeSec || moments[i - 1].timeSec) + TAIL_SEC;
        const gap = targetSec - prevEnd;
        if (gap > 2) {
          await fastForwardTo(targetSec, prevEnd);
        }
      }

      if (_cancelled) break;

      // Let the camera settle
      await keyboardSender.sleep(SETTLE_MS);

      // Play through the moment at 1× speed
      await keyboardSender.sendKey('numpad5');  // ensure playing
      const momentEnd = (m.endTimeSec || m.timeSec) + TAIL_SEC;
      const playDuration = (momentEnd - targetSec) * 1000;
      await keyboardSender.sleep(Math.max(1000, playDuration));

      if (_cancelled) break;

      // Pause before jumping to next
      await keyboardSender.sendKey('numpad5');  // pause
      await keyboardSender.sleep(300);
    }

    // 7. Done — notify renderer to stop recording
    emitProgress({ status: 'recording_stop' });
    emitProgress({
      status: 'complete',
      totalMoments: moments.length,
      message: 'Replay recording complete — ' + moments.length + ' moments captured',
    });

    _running = false;
    return {
      success: true,
      moments: moments.length,
      message: moments.length + ' moments recorded',
    };

  } catch (err) {
    _running = false;
    emitProgress({ status: 'error', message: err.message });
    throw err;
  }
}

// ── Enter iRacing replay mode ───────────────────────────────
async function enterReplay() {
  emitProgress({ status: 'entering_replay', message: 'Opening iRacing replay...' });

  // iRacing replay is typically already available after a race.
  // We just need to ensure we're in replay mode, not live.
  // Pressing Escape first ensures any overlay menus are closed.
  await keyboardSender.sendKey('escape');
  await keyboardSender.sleep(500);

  // Pause the replay so we have control
  await keyboardSender.sendKey('numpad5');
  await keyboardSender.sleep(300);
  // Press again to ensure we're paused (toggle)
  await keyboardSender.sendKey('numpad5');
  await keyboardSender.sleep(300);
  // One more pause — we want paused state
  await keyboardSender.sendKey('numpad5');
  await keyboardSender.sleep(500);
}

// ── Switch to broadcast/TV camera ───────────────────────────
async function switchToTVCamera() {
  emitProgress({ status: 'switching_camera', message: 'Switching to broadcast camera...' });

  // Ctrl+F12 cycles camera groups in iRacing.
  // Typically: Cockpit → Chase → TV1 → TV2 → Blimp → etc.
  // We press it several times to find a broadcast camera.
  // Most setups need 2-3 presses to reach TV view.
  for (let i = 0; i < 3; i++) {
    await keyboardSender.sendKey('f12', { ctrl: true });
    await keyboardSender.sleep(500);
  }
}

// ── Fast-forward to a target time ───────────────────────────
// iRacing doesn't have a "jump to time" command, so we hold
// Shift+Numpad6 (fast-forward) for an estimated duration.
async function fastForwardTo(targetSec, currentSec) {
  const gapSec = targetSec - currentSec;
  if (gapSec <= 0) return;

  // Hold Shift+Numpad6 for estimated duration
  // iRacing fast-forward is roughly 8× speed (variable)
  const holdMs = Math.max(500, (gapSec / FF_SPEED_RATIO) * 1000);

  emitProgress({
    status: 'fast_forward',
    message: 'Fast-forwarding ' + Math.round(gapSec) + 's...',
  });

  // Ensure we're playing first (unpause)
  await keyboardSender.sendKey('numpad5');
  await keyboardSender.sleep(200);

  // Hold fast-forward
  await keyboardSender.holdKey('numpad6', holdMs, { shift: true });
  await keyboardSender.sleep(200);

  // Pause after reaching target area
  await keyboardSender.sendKey('numpad5');
  await keyboardSender.sleep(300);

  // Unpause at 1× for the actual moment playback
  await keyboardSender.sendKey('numpad5');
}

// ── Cancel ──────────────────────────────────────────────────
function cancel() {
  if (_running) {
    _cancelled = true;
    emitProgress({ status: 'cancelling', message: 'Cancelling replay director...' });
  }
}

function cancelResult() {
  _running = false;
  emitProgress({ status: 'cancelled', message: 'Replay director cancelled' });
  return { success: true, cancelled: true, moments: _currentMoment };
}

// ── Progress ────────────────────────────────────────────────
function emitProgress(data) {
  if (_progressCallback) {
    _progressCallback(data);
  }
}

// ── Query state ─────────────────────────────────────────────
function isRunning() { return _running; }
function getProgress() {
  return {
    running: _running,
    current: _currentMoment,
    total: _totalMoments,
  };
}

// ── Helpers ─────────────────────────────────────────────────
function formatTime(sec) {
  var m = Math.floor(sec / 60);
  var s = Math.round(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// ── Public API ──────────────────────────────────────────────
module.exports = {
  parseSidecar,
  estimateTime,
  run,
  cancel,
  isRunning,
  getProgress,
};
