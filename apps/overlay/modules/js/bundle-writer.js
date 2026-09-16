// ═══════════════════════════════════════════════════════════════
// BUNDLE WRITER — .rcpdv producer
//
// Combines a finalized .mp4 with its paired .telemetry.jsonl into
// a single .rcpdv file by appending an ISO-BMFF `uuid` box carrying
// gzipped telemetry. The bytes underneath remain a valid MP4 — any
// player that can open .mp4 can open .rcpdv when pointed at the file.
//
// Spec: agents/skills/race-bundle-format/SKILL.md
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Format constants ─────────────────────────────────────────
// 16-byte UUID identifying our private box. First 12 bytes spell
// PRODRIVETLMY in ASCII; last 4 bytes are the box format version.
const PRODRIVE_TELEMETRY_UUID = Buffer.from([
  0x50, 0x52, 0x4F, 0x44, 0x52, 0x49, 0x56, 0x45, // PRODRIVE
  0x54, 0x4C, 0x4D, 0x59,                         // TLMY
  0x00, 0x00,                                     // reserved
  0x00, 0x01,                                     // box format version
]);

const SCHEMA_VERSION = 1;

// ── ULID generation ──────────────────────────────────────────
// Crockford base32, 26 chars: 10 timestamp + 16 random.
// Implemented inline to avoid a dependency for ~30 lines of code.
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(timestampMs) {
  const ts = timestampMs != null ? timestampMs : Date.now();
  const tsChars = encodeUlidTimestamp(ts);
  const randChars = encodeUlidRandom();
  return tsChars + randChars;
}

function encodeUlidTimestamp(ms) {
  let out = '';
  let value = ms;
  for (let i = 9; i >= 0; i--) {
    out = ULID_ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeUlidRandom() {
  const bytes = crypto.randomBytes(10);
  let out = '';
  // Treat 10 bytes as 80 bits, encode 5 bits at a time.
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ULID_ALPHABET[(acc >> bits) & 0x1F];
    }
  }
  if (bits > 0) {
    out += ULID_ALPHABET[(acc << (5 - bits)) & 0x1F];
  }
  return out;
}

// ── Sidecar parsing ──────────────────────────────────────────
// First JSONL line is `{ _type: 'header', startedAt, car, track, ... }`.
// Last line is typically `{ _type: 'summary', frames, durationMs, markers }`.
// Middle lines are per-frame telemetry rows.

function readSidecarMetadata(jsonlBuffer) {
  const text = jsonlBuffer.toString('utf8');
  const newlineIdx = text.indexOf('\n');
  if (newlineIdx < 0) {
    throw new Error('Sidecar JSONL is empty or has no newline');
  }
  const firstLine = text.slice(0, newlineIdx);
  const header = JSON.parse(firstLine);
  if (header._type !== 'header') {
    throw new Error(
      'Sidecar first line is not a header (_type=' + header._type + ')'
    );
  }

  // Count frames (newlines) for the bundle header — minus header + optional summary.
  let frameCount = 0;
  let summary = null;
  let i = newlineIdx + 1;
  while (i < text.length) {
    const next = text.indexOf('\n', i);
    const end = next < 0 ? text.length : next;
    const line = text.slice(i, end);
    if (line.length > 0) {
      // Cheap probe: only parse JSON if line starts with `{"_type"` to avoid
      // parsing every frame. Frame rows usually start with `{"t":` or `{"e":`.
      if (line.startsWith('{"_type"')) {
        try {
          const obj = JSON.parse(line);
          if (obj._type === 'summary') {
            summary = obj;
          } else {
            frameCount++;
          }
        } catch (_) {
          frameCount++;
        }
      } else {
        frameCount++;
      }
    }
    if (next < 0) break;
    i = next + 1;
  }

  return { header, summary, frameCount };
}

// ── Lightweight MP4 box scan for video metadata ──────────────
// We need duration/dimensions/codec for the bundle header. Probing
// via ffprobe would be ideal but adds a subprocess call — for the
// initial bundle write we can read the existing transcode result's
// reported metadata, since the caller already invoked ffmpeg.

function probeMp4Minimal(mp4Path) {
  // Return a stub today; the caller (transcode-recording handler)
  // already has dimensions/duration/codec from ffmpeg output and
  // will pass them via opts. Falling back to file size + zero values
  // is acceptable for v1; the editor re-probes via AVAsset on open.
  let size = 0;
  try { size = fs.statSync(mp4Path).size; } catch (_) {}
  return {
    fileBytes: size,
    duration: 0,
    width: 0,
    height: 0,
    frameRate: 0,
    codec: 'h264',
  };
}

// ── ISO-BMFF box writers ─────────────────────────────────────
// All ISO-BMFF box sizes are big-endian 32-bit. Top-level box is
// [size:4][type:4][...payload...]. For uuid boxes the payload starts
// with a 16-byte UUID then arbitrary content.

function writeUuidBox(uuid, payload) {
  if (uuid.length !== 16) {
    throw new Error('UUID must be 16 bytes, got ' + uuid.length);
  }
  // 4 (size) + 4 (type) + 16 (uuid) + payload
  const total = 8 + 16 + payload.length;
  if (total > 0xFFFFFFFF) {
    // Would need the 64-bit largesize form; gzipped JSONL won't realistically
    // exceed 4GB. Surface an error rather than silently producing bad output.
    throw new Error('uuid box payload too large for 32-bit size field');
  }
  const out = Buffer.alloc(total);
  out.writeUInt32BE(total, 0);
  out.write('uuid', 4, 'ascii');
  uuid.copy(out, 8);
  payload.copy(out, 24);
  return out;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Combine an mp4 + telemetry.jsonl pair into a single .rcpdv bundle.
 *
 * Reads the mp4 in one shot, appends a uuid box carrying the gzipped
 * sidecar plus a JSON header. Output is written to outputPath.
 *
 * @param {object} opts
 * @param {string} opts.mp4Path        — finalized MP4 (post-transcode)
 * @param {string} opts.telemetryPath  — paired .telemetry.jsonl
 * @param {string} [opts.outputPath]   — defaults to mp4Path with .rcpdv extension
 * @param {object} [opts.appInfo]      — { app, version, platform } for createdBy
 * @param {object} [opts.race]         — overrides for the race block
 * @param {object} [opts.video]        — { duration, width, height, frameRate, codec }
 * @param {string} [opts.userId]       — discord user id, e.g. 'discord:123'
 * @returns {{ outputPath, bundleId, headerBytes, telemetryBytes }}
 */
function writeBundle(opts) {
  if (!opts || !opts.mp4Path) throw new Error('mp4Path is required');
  if (!opts.telemetryPath) throw new Error('telemetryPath is required');

  const mp4Path = opts.mp4Path;
  const telemetryPath = opts.telemetryPath;
  const outputPath =
    opts.outputPath ||
    mp4Path.replace(/\.(mp4|mov|m4v)$/i, '') + '.rcpdv';

  if (!fs.existsSync(mp4Path)) {
    throw new Error('MP4 not found: ' + mp4Path);
  }
  if (!fs.existsSync(telemetryPath)) {
    throw new Error('Telemetry sidecar not found: ' + telemetryPath);
  }

  // 1. Read source files.
  const mp4Bytes = fs.readFileSync(mp4Path);
  const telemetryBytes = fs.readFileSync(telemetryPath);

  // 2. Parse sidecar metadata (header + frame count).
  const { header: sidecarHeader, summary, frameCount } =
    readSidecarMetadata(telemetryBytes);

  // 3. Compress telemetry.
  const compressed = zlib.gzipSync(telemetryBytes);

  // 4. Probe MP4 for fallback metadata (caller-supplied opts.video wins).
  const probed = probeMp4Minimal(mp4Path);
  const video = Object.assign({}, probed, opts.video || {});

  // 5. Build the bundle header.
  const bundleId = generateUlid(Date.parse(sidecarHeader.startedAt) || undefined);
  const createdAt = new Date().toISOString();
  const startedAt = sidecarHeader.startedAt || createdAt;

  const appInfo = opts.appInfo || {};
  const race = Object.assign(
    {
      title: deriveTitle(sidecarHeader),
      track: sidecarHeader.track || null,
      car: sidecarHeader.car || null,
      series: null,
      sessionType: null,
      sessionId: null,
      gameId: sidecarHeader.gameId || null,
      isDemo: !!sidecarHeader.isDemo,
      userId: opts.userId || null,
    },
    opts.race || {}
  );

  const bundleHeader = {
    schemaVersion: SCHEMA_VERSION,
    bundleId: bundleId,
    createdAt: createdAt,
    startedAt: startedAt,
    createdBy: {
      app: appInfo.app || 'prodrive-overlay',
      version: appInfo.version || null,
      platform: appInfo.platform || process.platform,
    },
    race: race,
    video: {
      duration: video.duration || 0,
      frameRate: video.frameRate || 0,
      width: video.width || 0,
      height: video.height || 0,
      codec: video.codec || 'h264',
    },
    telemetry: {
      frameCount: frameCount,
      frameRate: 60,
      schema: 'prodrive-telemetry-v3',
      compressedBytes: compressed.length,
      uncompressedBytes: telemetryBytes.length,
      hasSummary: summary != null,
    },
  };

  // 6. Assemble the box payload: [headerLen:4][headerJSON][gzipped JSONL].
  const headerJson = Buffer.from(JSON.stringify(bundleHeader), 'utf8');
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(headerJson.length, 0);
  const payload = Buffer.concat([lenPrefix, headerJson, compressed]);

  // 7. Wrap in a uuid box.
  const uuidBox = writeUuidBox(PRODRIVE_TELEMETRY_UUID, payload);

  // 8. Write atomically: tmp file then rename. Avoids leaving a half-written
  //    .rcpdv if the caller crashes mid-write or the disk fills up.
  const tmpPath = outputPath + '.tmp';
  fs.writeFileSync(tmpPath, Buffer.concat([mp4Bytes, uuidBox]));
  fs.renameSync(tmpPath, outputPath);

  return {
    outputPath: outputPath,
    bundleId: bundleId,
    headerBytes: headerJson.length,
    telemetryBytes: compressed.length,
    totalBytes: mp4Bytes.length + uuidBox.length,
    frameCount: frameCount,
  };
}

function deriveTitle(sidecarHeader) {
  const parts = [];
  if (sidecarHeader.track) parts.push(sidecarHeader.track);
  if (sidecarHeader.car) parts.push(sidecarHeader.car);
  if (parts.length === 0) {
    return 'Untitled session';
  }
  return parts.join(' — ');
}

// ── Reader (for diagnostics + the same-machine "show what we just wrote") ──

/**
 * Read the bundle header without decompressing the telemetry. Cheap.
 * Returns null if the file is not a Prodrive bundle.
 */
function readBundleHeader(rcpdvPath) {
  const fd = fs.openSync(rcpdvPath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    let offset = 0;
    while (offset + 8 <= fileSize) {
      const sizeBuf = Buffer.alloc(8);
      fs.readSync(fd, sizeBuf, 0, 8, offset);
      const boxSize = sizeBuf.readUInt32BE(0);
      const boxType = sizeBuf.toString('ascii', 4, 8);
      if (boxSize < 8) break; // malformed; bail
      if (boxType === 'uuid' && boxSize >= 24) {
        const uuid = Buffer.alloc(16);
        fs.readSync(fd, uuid, 0, 16, offset + 8);
        if (uuid.equals(PRODRIVE_TELEMETRY_UUID)) {
          const headerLenBuf = Buffer.alloc(4);
          fs.readSync(fd, headerLenBuf, 0, 4, offset + 24);
          const headerLen = headerLenBuf.readUInt32BE(0);
          if (headerLen > boxSize) break; // malformed
          const headerBuf = Buffer.alloc(headerLen);
          fs.readSync(fd, headerBuf, 0, headerLen, offset + 28);
          return JSON.parse(headerBuf.toString('utf8'));
        }
      }
      // Advance to next top-level box. boxSize === 1 means 64-bit largesize follows.
      if (boxSize === 1) {
        const largeBuf = Buffer.alloc(8);
        fs.readSync(fd, largeBuf, 0, 8, offset + 8);
        const high = largeBuf.readUInt32BE(0);
        const low = largeBuf.readUInt32BE(4);
        offset += high * 0x100000000 + low;
      } else {
        offset += boxSize;
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  PRODRIVE_TELEMETRY_UUID,
  SCHEMA_VERSION,
  writeBundle,
  readBundleHeader,
};
