// ═══════════════════════════════════════════════════════════════
// FFMPEG ENCODER — GPU-accelerated post-recording transcode
// Runs in the main process. After MediaRecorder writes a .webm,
// this module transcodes it to MP4 with NVENC (4090) or software
// fallback. Designed for the "record then transcode" pipeline.
// ═══════════════════════════════════════════════════════════════

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Locate the FFmpeg binary ─────────────────────────────────
// ffmpeg-static provides a path to the bundled binary.
// In production (asar), the binary is unpacked to app.asar.unpacked/.
let _ffmpegPath = null;

function getFfmpegPath() {
  if (_ffmpegPath) return _ffmpegPath;

  try {
    // Try ffmpeg-static first (npm package)
    _ffmpegPath = require('ffmpeg-static');
    // In asar builds, the binary path needs fixing
    if (_ffmpegPath && _ffmpegPath.includes('app.asar')) {
      _ffmpegPath = _ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
  } catch (e) {
    // Fallback: check if ffmpeg is on PATH
    try {
      const which = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
      _ffmpegPath = execSync(which, { encoding: 'utf8' }).trim().split('\n')[0];
    } catch (e2) {
      _ffmpegPath = null;
    }
  }

  return _ffmpegPath;
}

// ── Detect available hardware encoders ───────────────────────
let _detectedEncoder = null;
let _encoderProbed = false;

function detectEncoder() {
  if (_encoderProbed) return _detectedEncoder;
  _encoderProbed = true;

  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    _detectedEncoder = null;
    return null;
  }

  try {
    const output = execSync(`"${ffmpeg}" -encoders 2>&1`, { encoding: 'utf8', timeout: 5000 });

    // Priority: NVENC (NVIDIA) → QSV (Intel) → AMF (AMD) → software
    if (output.includes('h264_nvenc')) {
      _detectedEncoder = 'h264_nvenc';
    } else if (output.includes('h264_qsv')) {
      _detectedEncoder = 'h264_qsv';
    } else if (output.includes('h264_amf')) {
      _detectedEncoder = 'h264_amf';
    } else {
      _detectedEncoder = 'libx264';
    }
  } catch (e) {
    _detectedEncoder = 'libx264';  // safe fallback
  }

  return _detectedEncoder;
}

// ── Encoder-specific arguments ───────────────────────────────
// Returns FFmpeg args for the detected (or forced) encoder.
// Bitrates are scaled for 3440×1440 ultrawide (~5MP/frame).
function getEncoderArgs(encoder, options) {
  options = options || {};
  var quality = options.quality || 'high';

  // Bitrate targets by quality (scaled for ultrawide)
  var bitrates = {
    low:    { target: '10M',  max: '15M',  buf: '20M' },
    medium: { target: '18M',  max: '25M',  buf: '30M' },
    high:   { target: '28M',  max: '40M',  buf: '50M' },
  };
  var br = bitrates[quality] || bitrates.high;

  switch (encoder) {
    case 'h264_nvenc':
      return [
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',           // medium — good quality/speed
        '-rc', 'vbr',              // variable bitrate
        '-cq', '23',               // constant quality target
        '-b:v', br.target,
        '-maxrate', br.max,
        '-bufsize', br.buf,
        '-profile:v', 'high',
        '-g', '120',               // keyframe every 2s at 60fps
      ];

    case 'h264_qsv':
      return [
        '-c:v', 'h264_qsv',
        '-preset', 'medium',
        '-global_quality', '23',
        '-b:v', br.target,
        '-maxrate', br.max,
        '-bufsize', br.buf,
        '-profile:v', 'high',
        '-g', '120',
      ];

    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-quality', 'balanced',
        '-rc', 'vbr_peak',
        '-b:v', br.target,
        '-maxrate', br.max,
        '-bufsize', br.buf,
        '-profile:v', 'high',
        '-g', '120',
      ];

    default:  // libx264 software fallback
      return [
        '-c:v', 'libx264',
        '-preset', 'fast',         // faster for software encoding
        '-crf', '23',
        '-maxrate', br.max,
        '-bufsize', br.buf,
        '-profile:v', 'high',
        '-g', '120',
      ];
  }
}

// ── Transcode .webm → .mp4 ──────────────────────────────────
// Returns a promise that resolves with { success, outputPath, duration }
// or rejects on error. Emits progress via the onProgress callback.
function transcode(inputPath, options, onProgress) {
  options = options || {};
  var encoder = (options.encoder && options.encoder !== 'auto') ? options.encoder : (detectEncoder() || 'libx264');
  var outputPath = options.outputPath || inputPath.replace(/\.webm$/i, '.mp4');
  var ffmpeg = getFfmpegPath();

  if (!ffmpeg) {
    return Promise.reject(new Error('FFmpeg not found. Install ffmpeg-static or add ffmpeg to PATH.'));
  }

  if (!fs.existsSync(inputPath)) {
    return Promise.reject(new Error('Input file not found: ' + inputPath));
  }

  var args = [
    '-y',                          // overwrite output
    '-i', inputPath,               // input .webm
  ];

  // Video encoding
  args = args.concat(getEncoderArgs(encoder, options));

  // Audio: transcode to AAC (better compatibility than opus in mp4)
  args = args.concat([
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',     // enable streaming playback
    outputPath,
  ]);

  return new Promise(function (resolve, reject) {
    var proc = spawn(ffmpeg, args, { windowsHide: true });
    var stderr = '';
    var duration = 0;

    proc.stderr.on('data', function (data) {
      var line = data.toString();
      stderr += line;

      // Parse duration from input metadata
      //   Duration: 00:05:23.45
      if (!duration) {
        var durMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (durMatch) {
          duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 +
                     parseInt(durMatch[3]) + parseInt(durMatch[4]) / 100;
        }
      }

      // Parse progress from encoding output
      //   time=00:01:23.45
      if (onProgress && duration > 0) {
        var timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (timeMatch) {
          var current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 +
                        parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 100;
          var pct = Math.min(100, Math.round((current / duration) * 100));
          onProgress({ percent: pct, current: current, total: duration });
        }
      }
    });

    proc.on('close', function (code) {
      if (code === 0) {
        var fileSize = 0;
        try { fileSize = fs.statSync(outputPath).size; } catch (e) { /* ok */ }
        resolve({
          success: true,
          outputPath: outputPath,
          encoder: encoder,
          fileSize: fileSize,
        });
      } else {
        reject(new Error('FFmpeg exited with code ' + code + ': ' + stderr.slice(-500)));
      }
    });

    proc.on('error', function (err) {
      reject(new Error('FFmpeg spawn error: ' + err.message));
    });
  });
}

// ── Delete source .webm after successful transcode ───────────
function cleanupSource(webmPath) {
  try {
    if (fs.existsSync(webmPath)) {
      fs.unlinkSync(webmPath);
    }
  } catch (e) { /* non-critical */ }
}

// ── Public API ───────────────────────────────────────────────
module.exports = {
  getFfmpegPath,
  detectEncoder,
  transcode,
  cleanupSource,
};
