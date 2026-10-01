// What is in the recordings folder (D:\Racing Desk\Recordings): one folder per recording, `<date> <track> <car>`,
// holding the video, its telemetry sidecar, the session's replay clips and its TV take (docs/recording.md). This reads
// the folders — each sidecar's header, nothing more — so that the desk can find the recording of a race (its start,
// its track) and the tray can find the latest. Pure: the file system is handed in.
const path = require('path');

const VIDEO_EXTS = Object.freeze(['.mp4', '.mkv', '.mov', '.webm', '.flv', '.ts', '.m4v']);
const SIDECAR = '.telemetry.jsonl';
const HEAD_BYTES = 64 * 1024;
const BEFORE_MS = 20 * 60 * 1000;      // a recording may begin before the session the store has (practice, the grid)
const AFTER_MS = 3 * 60 * 60 * 1000;   // and a session can be hours

const isClip = (name) => /^replay\b/i.test(name);
const isTake = (name) => /\stv\.telemetry\.jsonl$/i.test(name) || /\stv\.[a-z0-9]{2,5}$/i.test(name);

/** The sidecar's header line, or null. The first 64 kB are read; the header is line one. */
function readHeader(file, fsModule) {
  let fd = null;
  try {
    fd = fsModule.openSync(file, 'r');
    const size = fsModule.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, HEAD_BYTES));
    fsModule.readSync(fd, buffer, 0, buffer.length, 0);
    const first = buffer.toString('utf8').split('\n')[0];
    const parsed = JSON.parse(first);
    return parsed && parsed._type === 'header' ? parsed : null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fsModule.closeSync(fd); } catch (e) { /* closed */ } }
  }
}

/** The recording in a folder — its main sidecar, its video, its header — or null when the folder holds none. */
function recordingIn(folder, { fs: fsModule }) {
  let names;
  try { names = fsModule.readdirSync(folder); } catch (e) { return null; }
  const sidecars = names.filter((n) => n.toLowerCase().endsWith(SIDECAR) && !isClip(n) && !isTake(n)).sort();
  if (!sidecars.length) return null;
  const sidecar = sidecars[sidecars.length - 1];
  const base = sidecar.slice(0, -SIDECAR.length);
  const video = names.find((n) => VIDEO_EXTS.includes(path.extname(n).toLowerCase()) && path.basename(n, path.extname(n)) === base) || null;
  const header = readHeader(path.join(folder, sidecar), fsModule);
  const startedAt = header && header.startedAt ? Date.parse(header.startedAt) : NaN;
  const take = names.find((n) => isTake(n) && VIDEO_EXTS.includes(path.extname(n).toLowerCase())) || null;
  return {
    folder,
    name: path.basename(folder),
    sidecar: path.join(folder, sidecar),
    video: video ? path.join(folder, video) : null,
    take: take ? path.join(folder, take) : null,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    track: header && typeof header.track === 'string' ? header.track : null,
    car: header && typeof header.car === 'string' ? header.car : null,
    clips: names.filter((n) => isClip(n) && VIDEO_EXTS.includes(path.extname(n).toLowerCase())).length,
  };
}

/** Every recording under the root, the newest first (by the sidecar's start; folders with no sidecar are not recordings). */
function listRecordings(root, { fs: fsModule }) {
  let names;
  try { names = fsModule.readdirSync(root); } catch (e) { return []; }
  const out = [];
  for (const name of names) {
    const folder = path.join(root, name);
    let isDir = false;
    try { isDir = fsModule.statSync(folder).isDirectory(); } catch (e) { isDir = false; }
    if (!isDir || /^replays$/i.test(name)) continue;
    const found = recordingIn(folder, { fs: fsModule });
    if (found) out.push(found);
  }
  return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The words of a track's name that name no place: 'Circuit Zandvoort' and 'Silverstone Circuit' share one.
const GENERIC = new Set(['circuit', 'raceway', 'international', 'speedway', 'motorsport', 'motorsports', 'park', 'course', 'track',
  'full', 'grand', 'prix', 'gp', 'the', 'and', 'of', 'de', 'road', 'oval', 'short', 'long', 'north', 'south', 'east', 'west', 'layout',
  'config', 'club', 'national', 'historic', 'legacy', 'up', 'down']);
const placeWords = (s) => slug(s).split(' ').filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w));

/** Whether two track names are the same place, as the store and the sim name it ('Circuit Zandvoort' and 'zandvoort'). */
function sameTrack(a, b) {
  const x = slug(a);
  const y = slug(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const wx = new Set(placeWords(x));
  return placeWords(y).some((w) => wx.has(w));
}

/**
 * The recording of a race the store has: begun within twenty minutes before its start and three hours after, at the
 * same track where the two say one; the nearest start wins. `startedAt` is the session's, as the store gives it.
 */
function matchRace(list, { startedAt, track = null, beforeMs = BEFORE_MS, afterMs = AFTER_MS } = {}) {
  const at = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  if (!Number.isFinite(at)) return null;
  const near = (list || []).filter((r) => r && Number.isFinite(r.startedAt) && r.startedAt >= at - beforeMs && r.startedAt <= at + afterMs);
  const tracked = track ? near.filter((r) => !r.track || sameTrack(r.track, track)) : near;
  const pool = tracked.length ? tracked : [];
  if (!pool.length) return null;
  return pool.sort((a, b) => Math.abs(a.startedAt - at) - Math.abs(b.startedAt - at))[0];
}

/** The newest recording of all, or null. */
function latest(list) {
  return (list || []).find((r) => r && Number.isFinite(r.startedAt)) || (list || [])[0] || null;
}

module.exports = { VIDEO_EXTS, SIDECAR, BEFORE_MS, AFTER_MS, readHeader, recordingIn, listRecordings, matchRace, latest, sameTrack, isClip, isTake };
