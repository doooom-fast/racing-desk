// Smoke test for bundle-writer.js
// Builds a minimal-but-valid MP4 stub + a synthetic sidecar, runs the
// writer, then reads the bundle header back and checks the round-trip.
//
// Run: `node modules/js/__tests__/bundle-writer.smoke.js`

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const bundleWriter = require('../bundle-writer');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcpdv-smoke-'));
const mp4Path = path.join(tmpDir, 'session.mp4');
const sidecarPath = path.join(tmpDir, 'session.telemetry.jsonl');

// ── Minimal MP4 stub ─────────────────────────────────────────
// Single ftyp box: [size:4=24]['ftyp']['isom'][minor:4=0][compat:'isom'][compat:'mp42']
function makeMinimalMp4Stub() {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);                // box size
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write('isom', 8, 'ascii');           // major brand
  ftyp.writeUInt32BE(0, 12);                // minor version
  ftyp.write('isom', 16, 'ascii');          // compat brand 1
  ftyp.write('mp42', 20, 'ascii');          // compat brand 2
  return ftyp;
}

// ── Synthetic sidecar ────────────────────────────────────────
function makeSidecar() {
  const lines = [];
  lines.push(JSON.stringify({
    _type: 'header',
    schemaVersion: 1,
    startedAt: new Date('2026-04-27T18:30:42.123Z').toISOString(),
    car: 'BMW M Hybrid V8',
    track: 'Spa-Francorchamps Grand Prix',
    gameId: 'iracing',
    isDemo: false,
  }));
  for (let i = 0; i < 5; i++) {
    lines.push(JSON.stringify({ t: i * 16.7, pos: i + 1, lap: 1, speed: 200 + i }));
  }
  lines.push(JSON.stringify({
    _type: 'summary',
    frames: 5,
    durationMs: 5 * 16.7,
    markers: [],
  }));
  return lines.join('\n') + '\n';
}

// ── Run ──────────────────────────────────────────────────────
let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log('  ✓', label);
  } else {
    console.log('  ✗', label);
    failures++;
  }
}

console.log('bundle-writer smoke test');
console.log('  tmpDir:', tmpDir);

fs.writeFileSync(mp4Path, makeMinimalMp4Stub());
fs.writeFileSync(sidecarPath, makeSidecar());

const result = bundleWriter.writeBundle({
  mp4Path: mp4Path,
  telemetryPath: sidecarPath,
  appInfo: { app: 'prodrive-overlay', version: '0.0.1-test', platform: 'test' },
  video: { duration: 5.0, frameRate: 60, width: 3440, height: 1440, codec: 'h264' },
  userId: 'discord:test',
});

assert(typeof result.outputPath === 'string', 'writeBundle returns outputPath');
assert(result.outputPath.endsWith('.rcpdv'), 'output extension is .rcpdv');
assert(fs.existsSync(result.outputPath), 'bundle file exists on disk');
assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(result.bundleId), 'bundleId is a valid ULID');
assert(result.frameCount === 5, 'frameCount excludes header + summary lines');

const stat = fs.statSync(result.outputPath);
assert(stat.size === result.totalBytes, 'on-disk size matches reported totalBytes');

const header = bundleWriter.readBundleHeader(result.outputPath);
assert(header != null, 'readBundleHeader finds the uuid box');
assert(header.schemaVersion === 1, 'schemaVersion is 1');
assert(header.bundleId === result.bundleId, 'bundleId round-trips');
assert(header.race.car === 'BMW M Hybrid V8', 'race.car comes from sidecar header');
assert(header.race.track === 'Spa-Francorchamps Grand Prix', 'race.track comes from sidecar header');
assert(header.race.userId === 'discord:test', 'race.userId comes from opts');
assert(header.video.width === 3440, 'video.width comes from opts');
assert(header.telemetry.frameCount === 5, 'telemetry.frameCount round-trips');
assert(header.telemetry.compressedBytes < header.telemetry.uncompressedBytes,
  'gzipped size is smaller than raw');
assert(header.createdBy.app === 'prodrive-overlay', 'createdBy.app round-trips');

// ── Verify the appended uuid box really is at the end and the ftyp is intact ──
const fullBytes = fs.readFileSync(result.outputPath);
assert(fullBytes.slice(0, 24).toString('hex').includes('66747970'),
  'ftyp box still present at offset 0');

// Extract the gzipped telemetry from the bundle and verify it round-trips.
const fd = fs.openSync(result.outputPath, 'r');
let foundTelemetry = null;
let offset = 0;
while (offset + 8 <= fullBytes.length) {
  const sz = fullBytes.readUInt32BE(offset);
  const ty = fullBytes.toString('ascii', offset + 4, offset + 8);
  if (ty === 'uuid') {
    const uuidBytes = fullBytes.slice(offset + 8, offset + 24);
    if (uuidBytes.equals(bundleWriter.PRODRIVE_TELEMETRY_UUID)) {
      const headerLen = fullBytes.readUInt32BE(offset + 24);
      const compressedStart = offset + 28 + headerLen;
      const compressedEnd = offset + sz;
      const compressed = fullBytes.slice(compressedStart, compressedEnd);
      foundTelemetry = zlib.gunzipSync(compressed).toString('utf8');
      break;
    }
  }
  if (sz < 8) break;
  offset += sz;
}
fs.closeSync(fd);

assert(foundTelemetry != null, 'telemetry payload is reachable in uuid box');
assert(foundTelemetry === makeSidecar(), 'gzipped telemetry round-trips byte-for-byte');

// ── Cleanup ──
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('');
if (failures > 0) {
  console.error(failures + ' assertion(s) failed');
  process.exit(1);
} else {
  console.log('all checks passed');
}
