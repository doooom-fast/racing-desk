// Recording format: gzipped JSONL.
//
//   line 1   {"format":"prodrive-replay","version":1, ...header}
//   frames   {"t":<ms>,"k":{...full payload}}          keyframe
//            {"t":<ms>,"d":{...changed keys},"x":[..]}  delta (x = keys removed)
//
// Payloads are the plugin's localhost:8889 HTTP body, parsed. Keyframes are written every
// `keyframeEveryMs` and followed by a zlib sync flush, so a recording cut off by a crash still
// reads back up to its last keyframe.

import { createGzip, gunzipSync, constants } from 'node:zlib';
import { createWriteStream, readFileSync } from 'node:fs';
import { once } from 'node:events';

export const FORMAT = 'prodrive-replay';
export const VERSION = 1;
export const EXTENSION = '.replay.jsonl.gz';

const sameValue = (a, b) =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

export function createRecordingWriter(path, header = {}) {
  const keyframeEveryMs = header.keyframeEveryMs ?? 2000;
  const file = createWriteStream(path);
  const gzip = createGzip();
  gzip.pipe(file);
  const line = (obj) => gzip.write(JSON.stringify(obj) + '\n');
  line({ format: FORMAT, version: VERSION, ...header, keyframeEveryMs });

  let prev = null;
  let lastKeyframeT = -Infinity;
  let frames = 0;

  return {
    get frames() { return frames; },
    write(t, payload) {
      if (!prev || t - lastKeyframeT >= keyframeEveryMs) {
        line({ t, k: payload });
        gzip.flush(constants.Z_SYNC_FLUSH);
        lastKeyframeT = t;
      } else {
        const d = {};
        let changed = false;
        for (const key of Object.keys(payload)) {
          if (!sameValue(payload[key], prev[key])) { d[key] = payload[key]; changed = true; }
        }
        const x = Object.keys(prev).filter((key) => !(key in payload));
        // Unchanged frames are skipped; playback holds the previous frame until the next change.
        if (!changed && !x.length) { prev = payload; return; }
        line(x.length ? { t, d, x } : { t, d });
      }
      prev = payload;
      frames++;
    },
    async close() {
      gzip.end();
      await once(file, 'finish');
    },
  };
}

export function readRecording(path) {
  const text = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]);
  if (header.format !== FORMAT) throw new Error(`${path}: not a ${FORMAT} recording`);
  if (header.version > VERSION) throw new Error(`${path}: recording version ${header.version} is newer than this reader (${VERSION})`);
  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    try { frames.push(JSON.parse(lines[i])); } catch {
      if (i === lines.length - 1) break; // truncated tail from an interrupted recording
      throw new Error(`${path}: corrupt frame on line ${i + 1}`);
    }
  }
  if (!frames.length || !frames[0].k) throw new Error(`${path}: no keyframe — recording is empty`);
  return { path, header, frames, duration: frames.at(-1).t };
}

// Reconstructs full payloads from keyframes + deltas. Sequential access (normal playback) is
// incremental; seeking backwards rebuilds from the nearest keyframe.
export class Player {
  constructor(recording) {
    this.recording = recording;
    this.frames = recording.frames;
    this.keyframes = [];
    this.frames.forEach((f, i) => { if (f.k) this.keyframes.push(i); });
    this.cacheIndex = -1;
    this.cacheState = null;
  }

  get duration() { return this.recording.duration; }

  indexAt(t) {
    let lo = 0, hi = this.frames.length - 1;
    if (t <= this.frames[0].t) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  stateAt(index) {
    index = Math.max(0, Math.min(index, this.frames.length - 1));
    if (index === this.cacheIndex) return this.cacheState;
    let lo = 0, hi = this.keyframes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.keyframes[mid] <= index) lo = mid; else hi = mid - 1;
    }
    const keyframe = this.keyframes[lo];
    let from, state;
    if (this.cacheIndex >= keyframe && this.cacheIndex < index) {
      from = this.cacheIndex + 1;
      state = this.cacheState;
    } else {
      from = keyframe + 1;
      state = structuredClone(this.frames[keyframe].k);
    }
    for (let i = from; i <= index; i++) {
      const f = this.frames[i];
      if (f.k) { state = structuredClone(f.k); continue; }
      Object.assign(state, f.d);
      if (f.x) for (const key of f.x) delete state[key];
    }
    this.cacheIndex = index;
    this.cacheState = state;
    return state;
  }
}
