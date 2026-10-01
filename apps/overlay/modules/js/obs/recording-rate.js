// The real size of his recordings: bytes per second over the newest few recordings in the recordings folder, each
// video's size over its duration — the duration read from the file's own boxes (mp4-info.js), never the video — for
// the card's "GB an hour" and the hours-left estimate. With a quality target instead of a fixed bitrate the rate is
// whatever the racing came to, and only the files say. Pure: the file system and the MP4 reader are handed in.
//
// Only recordings Racing Desk filed count (a folder with a sidecar, recordings-index.js), their main video alone (not
// the replay clips, not a TV take), and only ones longer than half a minute: a mis-press says nothing of a race. An
// unfinished Hybrid MP4 (OBS crashed) counts by the length its fragments reach. The files are pooled — the sum of
// bytes over the sum of seconds — so a long race weighs more than a short practice.
//
// `since` (ms since the epoch) is when the encoder settings the recordings are made with began: a recording begun
// before it was made with other settings (a fixed 100 Mbps, say, which is 45 GB an hour whatever the racing) and says
// nothing of the new ones, so it is left out, and so is one whose start is not known. Without `since` every one counts.
const fs = require('fs');
const { listRecordings } = require('./recordings-index');
const { readMp4Info } = require('./mp4-info');

const NEWEST = 5;
const MIN_SECONDS = 30;

/**
 * { bytesPerSecond, gbPerHour, recordings, bytes, seconds, used: [{ video, bytes, durationMs, complete }] } from the
 * newest `newest` recordings under `root` that have a video with a length (and began at or after `since`, when it is given);
 * null while there is none.
 */
function measureRate(root, { fs: fsModule = fs, readMp4 = (file) => readMp4Info(file, { fs: fsModule }), newest = NEWEST, minSeconds = MIN_SECONDS, since = null } = {}) {
  if (!root) return null;
  const used = [];
  const from = Number.isFinite(since) ? since : null;
  for (const r of listRecordings(root, { fs: fsModule })) {
    if (used.length >= newest) break;
    if (!r.video) continue;
    if (from !== null && !(Number.isFinite(r.startedAt) && r.startedAt >= from)) continue;
    let bytes;
    try { bytes = fsModule.statSync(r.video).size; } catch (e) { continue; }
    let info = null;
    try { info = readMp4(r.video); } catch (e) { info = null; }
    if (!info || !Number.isFinite(info.durationMs) || info.durationMs < minSeconds * 1000 || !(bytes > 0)) continue;
    used.push({ video: r.video, bytes, durationMs: info.durationMs, complete: !!info.complete });
  }
  if (!used.length) return null;
  const bytes = used.reduce((sum, u) => sum + u.bytes, 0);
  const seconds = used.reduce((sum, u) => sum + u.durationMs, 0) / 1000;
  const bytesPerSecond = bytes / seconds;
  return { bytesPerSecond, gbPerHour: (bytesPerSecond * 3600) / 1e9, recordings: used.length, bytes, seconds, used };
}

module.exports = { NEWEST, MIN_SECONDS, measureRate };
