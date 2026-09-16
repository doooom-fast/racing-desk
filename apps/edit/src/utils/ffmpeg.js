// ═══════════════════════════════════════════════════════════════
// FFMPEG WRAPPER — GPU detection, command builder, execution
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

let _ffmpegPath = null;
let _encoder = null;

/**
 * Find ffmpeg on PATH. Throws if not found.
 */
export function getFFmpegPath() {
  if (_ffmpegPath) return _ffmpegPath;
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    _ffmpegPath = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    throw new Error('FFmpeg not found on PATH. Install FFmpeg to continue.');
  }
  return _ffmpegPath;
}

/**
 * Detect the best available H.264 encoder.
 */
export function detectEncoder() {
  if (_encoder) return _encoder;
  const ffmpeg = getFFmpegPath();
  try {
    const output = execSync(`"${ffmpeg}" -encoders 2>&1`, { encoding: 'utf8', timeout: 5000 });
    if (output.includes('h264_videotoolbox')) _encoder = 'h264_videotoolbox'; // macOS
    else if (output.includes('h264_nvenc')) _encoder = 'h264_nvenc';
    else if (output.includes('h264_qsv')) _encoder = 'h264_qsv';
    else if (output.includes('h264_amf')) _encoder = 'h264_amf';
    else _encoder = 'libx264';
  } catch {
    _encoder = 'libx264';
  }
  return _encoder;
}

/**
 * Run an FFmpeg command. Returns a promise.
 * @param {string[]} args - FFmpeg arguments (without the ffmpeg binary).
 * @param {function} [onProgress] - Progress callback({ percent, time }).
 */
export function runFFmpeg(args, onProgress) {
  const ffmpeg = getFFmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    let duration = 0;

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;

      // Parse duration
      if (!duration) {
        const m = line.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
      }

      // Parse progress
      if (onProgress && duration > 0) {
        const m = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (m) {
          const cur = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
          onProgress({ percent: Math.min(100, Math.round(cur / duration * 100)), time: cur });
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve({ success: true });
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
  });
}

/**
 * Probe a media file for duration and format info.
 */
export function probe(filePath) {
  const ffmpeg = getFFmpegPath();
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  try {
    const output = execSync(
      `"${ffprobe}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`Failed to probe ${filePath}: ${err.message}`);
  }
}
