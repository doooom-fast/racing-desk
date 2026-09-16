// ═══════════════════════════════════════════════════════════════
// FFMPEG ASSEMBLY — EDL → FFmpeg commands → rendered video
//
// Takes the edit-decisions.json and produces the final video by
// assembling cockpit + TV-view source files according to the cut
// list. Uses FFmpeg's concat demuxer + filter_complex for seamless
// multi-source assembly.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runFFmpeg, detectEncoder, getFFmpegPath } from '../utils/ffmpeg.js';
import { parseDuration, toFFmpegTime, formatDuration } from '../utils/time.js';

/**
 * Render the final edit from edit-decisions.json.
 * @param {string} dir - Session directory
 * @param {Object} [opts] - { output, quality, resolution, social }
 * @returns {Object} { success, outputPath }
 */
export async function renderEdit(dir, opts = {}) {
  // ── Load session + EDL ────────────────────────────────────
  const sessionPath = join(dir, 'session.json');
  const edlPath = join(dir, 'edit-decisions.json');

  if (!existsSync(sessionPath)) throw new Error('session.json not found. Run ingest first.');
  if (!existsSync(edlPath)) throw new Error('edit-decisions.json not found. Run analyze first.');

  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  const edl = JSON.parse(readFileSync(edlPath, 'utf8'));

  // ── Resolve source files ──────────────────────────────────
  const cockpitPath = session.sources?.cockpit?.path;
  const tvPath = session.sources?.tvView?.path;

  if (!cockpitPath || !existsSync(cockpitPath)) {
    throw new Error('Cockpit video not found: ' + (cockpitPath || 'none'));
  }

  const hasTVView = tvPath && existsSync(tvPath);
  if (!hasTVView) {
    console.log('  Note: No TV-view video found. All cuts will use cockpit source.');
  }

  // Validate source files exist before expensive rendering pipeline
  try {
    if (!existsSync(cockpitPath)) {
      throw new Error(`Source video missing: ${cockpitPath}`);
    }
    if (hasTVView && !existsSync(tvPath)) {
      throw new Error(`Source video missing: ${tvPath}`);
    }
  } catch (err) {
    throw new Error(`Source file validation failed: ${err.message}`);
  }

  // ── Determine output settings ─────────────────────────────
  const quality = opts.quality || 'final';
  const resolution = opts.resolution || '1080';
  const encoder = detectEncoder();
  const outputName = opts.output || `edit-${quality}.mp4`;
  const outputPath = outputName.includes('/') ? outputName : join(dir, outputName);

  const resMap = { '480': '854:480', '720': '1280:720', '1080': '1920:1080', '4k': '3840:2160' };
  const scaleFilter = resMap[resolution] || resMap['1080'];
  const bitrateMap = { '480': '2M', '720': '5M', '1080': '12M', '4k': '30M' };
  const bitrate = quality === 'draft' ? '3M' : (bitrateMap[resolution] || '12M');

  // ── Build segment list ────────────────────────────────────
  // Each cut in the EDL becomes an FFmpeg trim command
  const cuts = edl.cuts || [];
  if (cuts.length === 0) throw new Error('No cuts in edit-decisions.json');

  // Write a concat file for FFmpeg
  const segmentFiles = [];
  console.log(`  Rendering ${cuts.length} segments (${encoder}, ${resolution}p, ${bitrate})...`);

  const { unlinkSync } = await import('node:fs');

  try {
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      const startSec = parseDuration(cut.start);
      const endSec = parseDuration(cut.end);
      const duration = endSec - startSec;
      if (duration <= 0) continue;

      // Choose source file
      const sourceFile = (cut.source === 'tv' && hasTVView) ? tvPath : cockpitPath;
      const segmentPath = join(dir, `_segment_${String(i).padStart(3, '0')}.ts`);

      // Extract segment with FFmpeg
      const segArgs = [
        '-y',
        '-ss', toFFmpegTime(startSec),
        '-i', sourceFile,
        '-t', duration.toFixed(3),
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

      process.stdout.write(`  [${i + 1}/${cuts.length}] ${cut.start}–${cut.end} (${cut.source})...`);
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

  return { success: true, outputPath };
}
