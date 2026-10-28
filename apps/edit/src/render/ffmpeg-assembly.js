// ═══════════════════════════════════════════════════════════════
// FFMPEG ASSEMBLY — EDL → FFmpeg commands → rendered video
//
// Takes the edit-decisions.json and produces the final video by
// assembling cockpit + TV-view source files according to the cut
// list. Uses FFmpeg's concat demuxer + filter_complex for seamless
// multi-source assembly.
//
// The cuts are in the telemetry's time; each is turned into the
// video's own time here (planSegments, through utils/video-time.js),
// so a cut lands on the moment the telemetry found and not as far
// off as the recording's offset and pauses.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { runFFmpeg, detectEncoder } from '../utils/ffmpeg.js';
import { parseDuration, toFFmpegTime } from '../utils/time.js';
import { videoClock, videoRange } from '../utils/video-time.js';
import { isTvName } from '../ingest/parse-telemetry.js';

/**
 * Render the final edit from edit-decisions.json.
 * @param {string} dir - Session directory
 * @param {Object} [opts] - { output, quality, resolution, social, encoder, dryRun, cuts }
 *   `cuts` renders those in place of the EDL's (a clip); `dryRun` plans and renders nothing.
 * @returns {Object} { success, outputPath, plan }
 */
export async function renderEdit(dir, opts = {}) {
  // ── Load session + EDL ────────────────────────────────────
  const sessionPath = join(dir, 'session.json');
  const edlPath = join(dir, 'edit-decisions.json');

  if (!existsSync(sessionPath)) throw new Error('session.json not found. Run ingest first.');
  if (!opts.cuts && !existsSync(edlPath)) throw new Error('edit-decisions.json not found. Run analyze first.');

  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  const cuts = opts.cuts || JSON.parse(readFileSync(edlPath, 'utf8')).cuts || [];
  if (cuts.length === 0) throw new Error('No cuts in edit-decisions.json');

  // ── Plan the segments in the video's time ─────────────────
  const plan = planSegments(session, cuts);
  for (const note of plan.notes) console.log('  Note: ' + note);
  for (const s of plan.skipped) {
    console.log(`  Skipped ${s.cut.start}–${s.cut.end} (${s.cut.source}): ${s.why}.`);
  }

  // ── Determine output settings ─────────────────────────────
  const quality = opts.quality || 'final';
  const resolution = opts.resolution || '1080';
  const outputName = opts.output || `edit-${quality}.mp4`;
  const outputPath = isAbsolute(outputName) || /[\\/]/.test(outputName) ? resolve(outputName) : join(dir, outputName);

  if (opts.dryRun) {
    for (const s of plan.segments) {
      console.log(`  ${s.cut.start}–${s.cut.end} (${s.source}) → video ${toFFmpegTime(s.start)}–${toFFmpegTime(s.end)}`);
    }
    return { success: true, outputPath: null, plan };
  }
  if (plan.segments.length === 0) throw new Error('None of the cuts is in the video');

  const encoder = opts.encoder || detectEncoder();
  const resMap = { '480': '854:480', '720': '1280:720', '1080': '1920:1080', '4k': '3840:2160' };
  const scaleFilter = resMap[resolution] || resMap['1080'];
  const bitrateMap = { '480': '2M', '720': '5M', '1080': '12M', '4k': '30M' };
  const bitrate = quality === 'draft' ? '3M' : (bitrateMap[resolution] || '12M');

  // ── Render each segment ───────────────────────────────────
  const segmentFiles = [];
  const total = plan.segments.length;
  console.log(`  Rendering ${total} segments (${encoder}, ${resolution}p, ${bitrate})...`);

  try {
    for (let i = 0; i < total; i++) {
      const seg = plan.segments[i];
      const segmentPath = join(dir, `_segment_${String(i).padStart(3, '0')}.ts`);

      // Extract segment with FFmpeg
      const segArgs = [
        '-y',
        '-ss', toFFmpegTime(seg.start),
        '-i', seg.path,
        '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', encoder,
        '-b:v', bitrate,
        '-c:a', 'aac', '-b:a', '128k',
        '-vf', `scale=${scaleFilter}:force_original_aspect_ratio=decrease,pad=${scaleFilter}:(ow-iw)/2:(oh-ih)/2`,
        '-f', 'mpegts',
        segmentPath,
      ];

      // Add quality-specific encoder args
      if (encoder === 'libx264') {
        segArgs.splice(segArgs.indexOf('-c:v') + 2, 0, '-preset', quality === 'draft' ? 'ultrafast' : 'fast');
      } else if (encoder === 'h264_videotoolbox') {
        // macOS hardware encoder
      } else if (encoder === 'h264_nvenc') {
        segArgs.splice(segArgs.indexOf('-c:v') + 2, 0, '-preset', 'p4');
      }

      process.stdout.write(`  [${i + 1}/${total}] ${seg.cut.start}–${seg.cut.end} (${seg.source}, video ${toFFmpegTime(seg.start)})...`);
      await runFFmpeg(segArgs);
      console.log(' ✓');

      segmentFiles.push(segmentPath);
    }

    // ── Concatenate segments ──────────────────────────────────
    if (segmentFiles.length === 0) throw new Error('No segments were rendered');

    console.log('  Concatenating segments...');
    // Escape single quotes and special characters in paths for concat demuxer
    const concatInput = segmentFiles.map(f => {
      const escaped = f.replace(/'/g, "'\\''");
      return `file '${escaped}'`;
    }).join('\n');
    const concatListPath = join(dir, '_concat_list.txt');
    writeFileSync(concatListPath, concatInput);

    const concatArgs = [
      '-y',
      '-f', 'concat', '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ];

    await runFFmpeg(concatArgs);
    console.log(`  ✓ Output: ${outputPath}`);
  } finally {
    // ── Cleanup temp segments (always runs, even on FFmpeg failure) ─
    for (const f of segmentFiles) {
      try { unlinkSync(f); } catch { /* ok */ }
    }
    try { unlinkSync(join(dir, '_concat_list.txt')); } catch { /* ok */ }
  }

  // ── Social media export (optional) ────────────────────────
  if (opts.social) {
    console.log('  Rendering 9:16 vertical export...');
    const verticalPath = outputPath.replace(/\.mp4$/, '-vertical.mp4');
    const vertArgs = [
      '-y',
      '-i', outputPath,
      '-vf', 'crop=ih*9/16:ih,scale=1080:1920',
      '-c:v', encoder,
      '-b:v', '8M',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      verticalPath,
    ];
    await runFFmpeg(vertArgs);
    console.log(`  ✓ Vertical: ${verticalPath}`);
  }

  return { success: true, outputPath, plan };
}

/**
 * Render each segment of the EDL's highlight reel as a clip of its own
 * (clip-01.mp4, …), from the cockpit, with a 9:16 copy of each if asked.
 * @param {string} dir - Session directory
 * @param {Object} [opts] - As renderEdit's, without `output` and `cuts`
 * @returns {Object} { success, clips: [outputPath] }
 */
export async function renderClips(dir, opts = {}) {
  const edlPath = join(dir, 'edit-decisions.json');
  if (!existsSync(edlPath)) throw new Error('edit-decisions.json not found. Run analyze first.');
  const segments = JSON.parse(readFileSync(edlPath, 'utf8')).highlight_reel?.segments || [];
  if (segments.length === 0) throw new Error('No highlight reel in edit-decisions.json');

  const clips = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const output = `clip-${String(i + 1).padStart(2, '0')}.mp4`;
    console.log(`  Clip ${i + 1}/${segments.length}: ${s.label || ''} ${s.start}–${s.end}`.replace(/\s+/g, ' '));
    const result = await renderEdit(dir, { ...opts, output, cuts: [{ start: s.start, end: s.end, source: 'cockpit' }] });
    if (result.outputPath) clips.push(result.outputPath);
  }
  return { success: true, clips };
}

/**
 * The segments to cut, in each source's own time: every cut of the EDL
 * (telemetry time, "M:SS") through the recording's clock, held to the file.
 * @param {Object} session - session.json
 * @param {Array<{start: string, end: string, source: string}>} cuts
 * @param {Object} [deps] - { exists } (a test's stand-in for existsSync)
 * @returns {{ segments: Array<{cut, source: 'cockpit'|'tv', path: string, start: number, end: number}>,
 *             skipped: Array<{cut, why: string}>, notes: string[] }}
 */
export function planSegments(session, cuts, { exists = existsSync } = {}) {
  const clock = videoClock(session.sidecarSummary);
  const cockpit = session.sources?.cockpit;
  const tv = session.sources?.tvView;
  const notes = [];

  if (!cockpit?.path || !exists(cockpit.path)) {
    throw new Error('Cockpit video not found: ' + (cockpit?.path || 'none'));
  }

  // The TV view is on the recording's clock only when it was recorded beside it: a recording from before OBS,
  // with no offset to apply. A TV take ("… tv.mp4") is the replay's moments recorded one after another, on a clock
  // of its own, and any other second file of an OBS recording (a split) is not the cockpit's either, so a cut in the
  // race's time cannot be found in them yet: their cuts are the cockpit's.
  let tvPath = null;
  if (tv?.path && exists(tv.path)) {
    if (isTvName(tv.file || tv.path) || clock.known) {
      if (cuts.some((c) => c.source === 'tv')) {
        notes.push('The TV video is not on the recording\'s clock, so its cuts use the cockpit.');
      }
    } else {
      tvPath = tv.path;
    }
  } else if (cuts.some((c) => c.source === 'tv')) {
    notes.push('No TV-view video found. All cuts will use cockpit source.');
  }

  const segments = [];
  const skipped = [];
  for (const cut of cuts) {
    const start = parseDuration(cut.start);
    const end = parseDuration(cut.end);
    if (!(end > start)) {
      skipped.push({ cut, why: 'it is empty' });
      continue;
    }
    const useTv = cut.source === 'tv' && tvPath !== null;
    const source = useTv ? tv : cockpit;
    const range = videoRange(clock, start, end, source.duration || 0);
    if (!range) {
      skipped.push({ cut, why: 'that stretch is not in the video' });
      continue;
    }
    segments.push({ cut, source: useTv ? 'tv' : 'cockpit', path: source.path, start: range.start, end: range.end });
  }
  return { segments, skipped, notes };
}
