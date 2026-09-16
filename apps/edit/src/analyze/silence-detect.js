// ═══════════════════════════════════════════════════════════════
// SILENCE DETECTION — FFmpeg silencedetect wrapper
//
// Uses FFmpeg's silencedetect filter to find silent stretches in
// the mic audio track. Silence = driver isn't talking = probably
// nothing interesting happening. This is the strongest single
// "boring" signal for the condenser.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import { getFFmpegPath } from '../utils/ffmpeg.js';

/**
 * Detect silent intervals in an audio/video file.
 * @param {string} filePath - Path to media file (mp4, webm, aac, etc.)
 * @param {Object} [opts] - { noiseDb: -30, minDuration: 5 }
 * @returns {Array<{start: number, end: number, duration: number}>}
 */
export function detectSilence(filePath, opts = {}) {
  const ffmpeg = getFFmpegPath();
  const noiseDb = opts.noiseDb || -30;
  const minDuration = opts.minDuration || 5;

  try {
    const output = execSync(
      `"${ffmpeg}" -i "${filePath}" -af silencedetect=noise=${noiseDb}dB:d=${minDuration} -f null - 2>&1`,
      { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );

    const silences = [];
    let currentStart = null;

    for (const line of output.split('\n')) {
      // Parse: [silencedetect @ 0x...] silence_start: 12.345
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        currentStart = parseFloat(startMatch[1]);
        continue;
      }

      // Parse: [silencedetect @ 0x...] silence_end: 18.678 | silence_duration: 6.333
      const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
      if (endMatch && currentStart !== null) {
        silences.push({
          start: currentStart,
          end: parseFloat(endMatch[1]),
          duration: parseFloat(endMatch[2]),
        });
        currentStart = null;
      }
    }

    return silences;
  } catch (err) {
    console.warn('  Silence detection failed (continuing without):', err.message?.slice(0, 100));
    return [];
  }
}
