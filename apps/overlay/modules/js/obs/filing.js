// Where a recording's files go, and how the telemetry is lined up with the video once the file is finished.
//
// - One folder per recording under the recordings folder: `<date> <track> <car>` (`2026-09-29 22-13 Zandvoort Porsche
//   992 Cup`), the date local, the names as the sim gives them with what a folder cannot hold taken out; the date
//   alone where the sim did not say. The video, its sidecar, and the replay clips and TV takes of that session go in
//   it together.
// - The move is a rename on the same drive — Set up OBS points OBS's own folder at the recordings folder for that —
//   made after STOPPED once the file's size has held still for two seconds (OBS closes the file before it says
//   STOPPED; the check is a cheap guard), with a few tries for a file still held. Across drives nothing is copied (a
//   24 GB file would take minutes): the file stays where OBS left it, its sidecar beside it, and the card says so.
// - The video offset. STARTED is only a provisional t = 0: an output joining a running encoder waits for the next
//   keyframe (up to four seconds at his interval), and OBS's own clock is not the one the frames were polled on. So
//   once the file is finished the chapters Racing Desk sent are read back from its chapter track (mp4-info.js) and
//   paired, in order and by name, with the t each was sent at: the offset is the median of (file time − t). With no
//   pair — a plain MP4, chapters off, a file cut short by a crash, a replay clip — the file is lined up from its end:
//   the moment it stopped (or the clip was saved) less its duration is when it began.
//
// Every file operation takes its fs, clock and timer, so the tests run it over temp folders.
const path = require('path');
const fs = require('fs');

const STABLE_MS = 2000;
const STABLE_POLL_MS = 500;
const STABLE_TIMEOUT_MS = 60000;
const MOVE_TRIES = 10;
const MOVE_RETRY_MS = 500;
const FOLDER_PART_MAX = 60;

const pad = (n) => String(n).padStart(2, '0');

/** `2026-09-29 22-13` for a moment, in local time. */
function folderDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/** A name the sim gave, as a folder can hold it: no `<>:"/\|?*`, no control characters, one space between words. */
function folderPart(name) {
  if (typeof name !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return cleaned.length > FOLDER_PART_MAX ? cleaned.slice(0, FOLDER_PART_MAX).trim() : cleaned;
}

/** The recording's folder name: the date, then the track and the car where the sim said them. */
function folderNameFor({ startedAt, track = null, car = null }) {
  return [folderDate(startedAt), folderPart(track), folderPart(car)].filter(Boolean).join(' ');
}

/** The drive letter (or UNC share) of a path, lower-cased, for "a rename stays on one drive"; '' where there is none. */
function driveOf(p) {
  try {
    const root = path.win32.parse(String(p || '')).root;
    return root.replace(/[\\/]+$/, '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function sameDrive(a, b) {
  const da = driveOf(a);
  const db = driveOf(b);
  return !!da && da === db;
}

/** `target`, or `target (2)`, `target (3)`… — the first that is not there. */
function uniquePath(target, { exists = fs.existsSync } = {}) {
  if (!exists(target)) return target;
  const { dir, name, ext } = path.parse(target);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${name} (${i})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  return path.join(dir, `${name} (${Date.now()})${ext}`);
}

/**
 * Resolves { ok, size } once the file's size has not changed for `stableMs`, polling every `pollMs`; { ok: false }
 * after `timeoutMs`, or when the file is not there.
 */
function waitForStableFile(file, { fs: fsModule = fs, setTimer = setTimeout, now = Date.now, stableMs = STABLE_MS, pollMs = STABLE_POLL_MS, timeoutMs = STABLE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const began = now();
    let lastSize = -1;
    let sameSince = now();
    const look = () => {
      let size;
      try { size = fsModule.statSync(file).size; } catch (e) { resolve({ ok: false, size: null, why: 'the file is not there' }); return; }
      const at = now();
      if (size !== lastSize) { lastSize = size; sameSince = at; }
      if (at - sameSince >= stableMs) { resolve({ ok: true, size }); return; }
      if (at - began >= timeoutMs) { resolve({ ok: false, size, why: 'the file kept changing' }); return; }
      const t = setTimer(look, pollMs);
      if (t && typeof t.unref === 'function') t.unref();
    };
    look();
  });
}

/**
 * Rename `from` to `to` on the same drive, trying again for a file still held (EBUSY, EPERM, EACCES) a few times.
 * Never across drives: { ok: false, why } says so and nothing is copied. Resolves { ok, to, why? }.
 */
async function moveFile(from, to, { fs: fsModule = fs, setTimer = setTimeout, tries = MOVE_TRIES, retryMs = MOVE_RETRY_MS } = {}) {
  if (!sameDrive(from, to)) return { ok: false, to: null, why: `${driveOf(from) || 'its drive'} and ${driveOf(to) || 'the folder\'s drive'} are different drives` };
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      fsModule.mkdirSync(path.dirname(to), { recursive: true });
      fsModule.renameSync(from, to);
      return { ok: true, to };
    } catch (e) {
      last = e;
      if (!/EBUSY|EPERM|EACCES/.test(String(e && e.code))) break;
      await new Promise((resolve) => { const t = setTimer(resolve, retryMs); if (t && typeof t.unref === 'function') t.unref(); });
    }
  }
  return { ok: false, to: null, why: last ? `${last.code || ''} ${last.message}`.trim() : 'could not be moved' };
}

// A chapter pair further than this from the middle of the others is not a pair: a chapter of ours that never reached
// OBS, or one of a name the file has twice, was matched with the wrong one.
const PAIR_TOLERANCE_MS = 1000;

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How much of the recording before sidecar time `t` (ms) was paused. `pauses` is [{ from, to }] in the same ms, `to`
 * null for a pause still open; the video's clock stops while OBS is paused, the sidecar's does not.
 */
function pausedBefore(pauses, t) {
  let total = 0;
  for (const p of Array.isArray(pauses) ? pauses : []) {
    if (!p || !Number.isFinite(p.from)) continue;
    const to = Number.isFinite(p.to) ? p.to : Infinity;
    if (to <= t) total += to - p.from;
    else if (p.from < t) total += t - p.from;
  }
  return total;
}

/**
 * The offset from the chapters: `ours` [{ name, t }] as OBS took them (t in ms from the provisional start), `theirs`
 * [{ name, ms }] as the file has them, and `pauses` [{ from, to }] if the recording was paused (the file's clock stood
 * still for them, ours did not, so each t is moved back by the pauses before it).
 *
 * Each chapter of ours is paired with the chapter of the same name the file has nearest to where it should be (below),
 * and neither is paired twice: "Pit in" and "Pit out" come again and again, and the first one found going forward is
 * the wrong one as soon as one of ours is missing from the file. The offset is the median of what is left after a pair
 * more than a second from the median is dropped; with half or more dropped the pairing is not to be believed and the
 * answer is null (the caller lines the file up from its end instead). OBS's own "Start" and anything else it added
 * are never paired.
 */
function alignFromChapters(ours, theirs, { pauses = [], toleranceMs = PAIR_TOLERANCE_MS } = {}) {
  if (!Array.isArray(ours) || !Array.isArray(theirs) || !ours.length || !theirs.length) return null;
  const mine = ours
    .filter((c) => c && typeof c.name === 'string' && Number.isFinite(c.t))
    .map((c) => ({ name: c.name, t: c.t - pausedBefore(pauses, c.t) }));
  const files = theirs.filter((c) => c && typeof c.name === 'string' && Number.isFinite(c.ms));
  if (!mine.length || !files.length) return null;

  const count = (list, name) => list.reduce((n, c) => n + (c.name === name ? 1 : 0), 0);
  const anchors = [];
  for (const m of mine) {
    if (count(mine, m.name) !== 1 || count(files, m.name) !== 1) continue;
    anchors.push(files.find((c) => c.name === m.name).ms - m.t);
  }
  // The pairs are made nearest first, each chapter of either list in at most one: nearest to where a chapter of ours
  // should be, which is its t plus the offset the names that occur once agree on (nothing agreed: its own t, an offset
  // of seconds against the minutes between a recording's pit stops). With names that agree, a pair further than a
  // second from where it should be is no candidate, so a chapter of ours the file lacks is left alone and does not
  // take the place of a later one's.
  const guess = anchors.length ? medianOf(anchors) : 0;
  const candidates = [];
  mine.forEach((m, i) => {
    files.forEach((f, k) => {
      if (f.name !== m.name) return;
      const off = Math.abs(f.ms - (m.t + guess));
      if (anchors.length && off > toleranceMs) return;
      candidates.push({ i, k, off });
    });
  });
  candidates.sort((a, b) => a.off - b.off || a.i - b.i || a.k - b.k);
  const usedMine = new Set();
  const usedFile = new Set();
  const diffs = [];
  for (const c of candidates) {
    if (usedMine.has(c.i) || usedFile.has(c.k)) continue;
    usedMine.add(c.i);
    usedFile.add(c.k);
    diffs.push(files[c.k].ms - mine[c.i].t);
  }
  if (!diffs.length) return null;

  const middle = medianOf(diffs);
  const kept = diffs.filter((d) => Math.abs(d - middle) <= toleranceMs);
  if (!kept.length || kept.length * 2 < diffs.length) return null;
  const offset = medianOf(kept);
  return {
    videoOffsetMs: Math.round(offset),
    method: 'chapters',
    pairs: kept.length,
    spreadMs: Math.round(Math.max(...kept) - Math.min(...kept)),
    ...(kept.length < diffs.length ? { dropped: diffs.length - kept.length } : {}),
  };
}

/**
 * The offset from the end: the file ended at `endedAt` (the moment the stop was asked for, or OBS was last seen
 * recording), so it began at `endedAt` less its duration, and a frame polled at wall time `at` is at video time
 * `at − (endedAt − durationMs)`: the offset to add to t (= at − startedAt) is startedAt − videoStart. A recording that
 * was paused: the file holds none of the pauses, so its start is that much earlier, and the offset is the one for the
 * frames before the first pause (`pauses` [{ from, to }] are the sidecar's own, in ms; the summary lists them).
 */
function alignFromEnd({ startedAt, endedAt, durationMs, approximate = false, pauses = [], endFrom = null }) {
  if (![startedAt, endedAt, durationMs].every((n) => Number.isFinite(n))) return null;
  const closed = (Array.isArray(pauses) ? pauses : []).filter((p) => p && Number.isFinite(p.from));
  const paused = closed.reduce((sum, p) => sum + ((Number.isFinite(p.to) ? p.to : endedAt - startedAt) - p.from), 0);
  const videoStart = endedAt - durationMs - paused;
  return {
    videoOffsetMs: Math.round(startedAt - videoStart),
    method: 'end',
    videoStartUtc: new Date(videoStart).toISOString(),
    durationMs: Math.round(durationMs),
    ...(endFrom ? { endFrom } : {}),
    ...(approximate || closed.length ? { approximate: true } : {}),
  };
}

/** The words of a chapter for a sidecar marker; null for a marker that is no chapter (a place lost, a file change). */
function chapterNameFor(marker) {
  if (!marker || typeof marker !== 'object') return null;
  switch (marker.type) {
    case 'new_lap': return Number.isFinite(marker.lap) ? `Lap ${marker.lap}` : null;
    case 'incident': { const n = Number(marker.to) - Number(marker.from); return `Incident ×${Number.isFinite(n) && n > 0 ? n : 1}`; }
    case 'pit_entry': return 'Pit in';
    case 'pit_exit': return 'Pit out';
    case 'position_change': return marker.direction === 'gained' ? `P${marker.from} → P${marker.to}` : null;
    default: return null;
  }
}

module.exports = {
  STABLE_MS, STABLE_TIMEOUT_MS, MOVE_TRIES, PAIR_TOLERANCE_MS,
  folderDate, folderPart, folderNameFor, driveOf, sameDrive, uniquePath,
  waitForStableFile, moveFile, pausedBefore, alignFromChapters, alignFromEnd, chapterNameFor,
};
