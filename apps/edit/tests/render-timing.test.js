// ═══════════════════════════════════════════════════════════════
// RENDER TIMING TEST — a real cut, through ffmpeg, lands where the
// telemetry says. Skipped where ffmpeg is not on PATH.
//
// The video is made here: 30 s whose brightness is the time (8 levels
// a second), so the first frame of what is cut says where it was cut.
// libx264 at 64x36: no GPU encoder is asked for.
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getFFmpegPath } from '../src/utils/ffmpeg.js';
import { renderEdit } from '../src/render/ffmpeg-assembly.js';

let ffmpeg = null;
try { ffmpeg = getFFmpegPath(); } catch { /* skipped below */ }

const LEVELS_PER_SEC = 8;

/** The mean brightness of the first frame of a video, as the time it shows. */
function firstFrameTime(path) {
  const out = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', 'crop=8:8:(iw-8)/2:(ih-8)/2', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 });
  assert.strictEqual(out.status, 0, String(out.stderr));
  const px = [...out.stdout];
  return px.reduce((a, b) => a + b, 0) / px.length / LEVELS_PER_SEC;
}

test('a cut lands on the moment of the telemetry, offset and pause taken out', { skip: !ffmpeg && 'ffmpeg is not on PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-edit-timing-'));
  try {
    const video = join(dir, 'race.mp4');
    const made = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=64x36:r=10:d=30,format=gray,geq=lum=T*${LEVELS_PER_SEC}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv444p', video]);
    assert.strictEqual(made.status, 0, String(made.stderr));
    assert.ok(Math.abs(firstFrameTime(video) - 0) < 0.3);

    // The file began 3.5 s after t 0, and was paused from t 15 to t 25.
    writeFileSync(join(dir, 'session.json'), JSON.stringify({
      sidecarSummary: { videoOffsetMs: -3500, alignment: { method: 'chapters' }, pauses: [{ from: 15000, to: 25000 }] },
      sources: { cockpit: { file: 'race.mp4', path: video, duration: 30 }, tvView: null, clips: [] },
    }));
    const opts = { encoder: 'libx264', quality: 'draft', resolution: '480' };

    await renderEdit(dir, { ...opts, output: 'before-pause.mp4', cuts: [{ start: '0:10', end: '0:12', source: 'cockpit' }] });
    const before = firstFrameTime(join(dir, 'before-pause.mp4'));
    assert.ok(Math.abs(before - 6.5) < 0.3, `t 10 was cut at ${before.toFixed(2)} s of the video, not 6.5`);

    await renderEdit(dir, { ...opts, output: 'after-pause.mp4', cuts: [{ start: '0:27', end: '0:29', source: 'cockpit' }] });
    const after = firstFrameTime(join(dir, 'after-pause.mp4'));
    assert.ok(Math.abs(after - 13.5) < 0.3, `t 27 was cut at ${after.toFixed(2)} s of the video, not 13.5`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
