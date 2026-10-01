// What a recording's MP4 says of itself, read without ffmpeg: its duration, and the chapters OBS wrote into it. The
// file is walked box by box with seeks — the mdat, which is the whole video, is never read — so a 24 GB file costs a
// few kilobytes of reads.
//
// Two layouts, both OBS's (plugins/obs-outputs/mp4-mux.c in 32.1.2):
// - A finished Hybrid MP4, and a plain MP4 (the replay buffer's clips, a file from before Set up OBS): a full `moov`
//   whose `mvhd` has the duration, and, for Hybrid MP4, a chapter track — a `trak` whose handler is `text`, referenced
//   from the video track's `tref/chap`, one sample per chapter: a two-byte length and the name, at the times its
//   `stts` adds up to (a timescale of 1000: milliseconds). OBS puts the full `moov` at the end when it finalises, and
//   writes a "Start" chapter of its own at 0 when the first chapter asked for is not at 0.
// - A Hybrid MP4 that was never finalised (OBS crashed, the machine went off): `ftyp`, a `free` placeholder, a
//   fragmented `moov` (duration 0, `mvex`), then `moof` + `mdat` pairs. The duration is the video track's last
//   fragment's decode time plus its samples' durations, in the track's own timescale. Chapters are lost with the
//   crash (they are written only at finalisation).
//
// readMp4Info(file) → { layout: 'final' | 'fragmented' | 'none', complete, durationMs, chapters: [{ name, ms }],
//                       video: { trackId, timescale } | null, bytes, problem? }
// Nothing here throws for a file that is not an MP4, or is cut short: layout 'none' and a `problem` sentence.
const fs = require('fs');

const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_MOOF_BYTES = 4 * 1024 * 1024;
const MAX_TOP_BOXES = 400000;      // an hour of one-second fragments is seven thousand
const MAX_CHAPTERS = 10000;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'dinf', 'mvex', 'moof', 'traf', 'tref']);

// Box flags in tfhd and trun (ISO 14496-12 8.8.7, 8.8.8).
const TFHD = Object.freeze({ BASE_DATA_OFFSET: 0x1, SAMPLE_DESC: 0x2, DEFAULT_DURATION: 0x8, DEFAULT_SIZE: 0x10, DEFAULT_FLAGS: 0x20 });
const TRUN = Object.freeze({ DATA_OFFSET: 0x1, FIRST_FLAGS: 0x4, DURATION: 0x100, SIZE: 0x200, FLAGS: 0x400, CTS: 0x800 });

function readBoxHeader(buf, pos, end) {
  if (pos + 8 > end) return null;
  let size = buf.readUInt32BE(pos);
  const type = buf.toString('latin1', pos + 4, pos + 8);
  let headerLen = 8;
  if (size === 1) {
    if (pos + 16 > end) return null;
    size = Number(buf.readBigUInt64BE(pos + 8));
    headerLen = 16;
  } else if (size === 0) {
    size = end - pos;
  }
  if (size < headerLen || pos + size > end) return null;
  return { type, size, headerLen };
}

/** The boxes inside [start, end) of `buf`, recursively for containers; stsd's entries are not descended into. */
function walk(buf, start, end, depth, out, parent = null) {
  for (let pos = start; pos + 8 <= end;) {
    const h = readBoxHeader(buf, pos, end);
    if (!h) break;
    const box = { type: h.type, pos, size: h.size, headerLen: h.headerLen, depth, parent, children: [] };
    if (parent) parent.children.push(box);
    out.push(box);
    if (CONTAINERS.has(h.type)) walk(buf, pos + h.headerLen, pos + h.size, depth + 1, out, box);
    pos += h.size;
  }
  return out;
}

const childOf = (box, type) => (box ? box.children.find((c) => c.type === type) || null : null);
const childrenOf = (box, type) => (box ? box.children.filter((c) => c.type === type) : []);

function fullBox(buf, box) {
  const d = box.pos + box.headerLen;
  return { version: buf[d], flags: buf.readUIntBE(d + 1, 3), data: d + 4 };
}

function readMvhd(buf, box) {
  const { version, data } = fullBox(buf, box);
  if (version === 1) return { timescale: buf.readUInt32BE(data + 16), duration: Number(buf.readBigUInt64BE(data + 20)) };
  return { timescale: buf.readUInt32BE(data + 8), duration: buf.readUInt32BE(data + 12) };
}

function readMdhd(buf, box) {
  const { version, data } = fullBox(buf, box);
  if (version === 1) return { timescale: buf.readUInt32BE(data + 16), duration: Number(buf.readBigUInt64BE(data + 20)) };
  return { timescale: buf.readUInt32BE(data + 8), duration: buf.readUInt32BE(data + 12) };
}

function readTkhdId(buf, box) {
  const { version, data } = fullBox(buf, box);
  return version === 1 ? buf.readUInt32BE(data + 16) : buf.readUInt32BE(data + 8);
}

function readHandler(buf, box) {
  const { data } = fullBox(buf, box);
  return buf.toString('latin1', data + 4, data + 8);
}

/** The sample table of a track: each sample's offset in the file, size and start time in the track's timescale. */
function readSamples(buf, stbl, { maxSamples = MAX_CHAPTERS } = {}) {
  const stts = childOf(stbl, 'stts');
  const stsc = childOf(stbl, 'stsc');
  const stsz = childOf(stbl, 'stsz');
  const stco = childOf(stbl, 'stco') || childOf(stbl, 'co64');
  if (!stts || !stsc || !stsz || !stco) return [];
  // Durations.
  const durations = [];
  {
    const { data } = fullBox(buf, stts);
    const n = buf.readUInt32BE(data);
    for (let i = 0, p = data + 4; i < n && durations.length < maxSamples; i++, p += 8) {
      const count = buf.readUInt32BE(p);
      const delta = buf.readUInt32BE(p + 4);
      for (let j = 0; j < count && durations.length < maxSamples; j++) durations.push(delta);
    }
  }
  // Sizes.
  const sizes = [];
  let fixedSize = 0;
  {
    const { data } = fullBox(buf, stsz);
    fixedSize = buf.readUInt32BE(data);
    const n = buf.readUInt32BE(data + 4);
    if (fixedSize === 0) {
      for (let i = 0, p = data + 8; i < n && i < maxSamples; i++, p += 4) sizes.push(buf.readUInt32BE(p));
    } else {
      for (let i = 0; i < n && i < maxSamples; i++) sizes.push(fixedSize);
    }
  }
  // Chunk offsets.
  const offsets = [];
  {
    const { data } = fullBox(buf, stco);
    const n = buf.readUInt32BE(data);
    const wide = stco.type === 'co64';
    for (let i = 0, p = data + 4; i < n && i < maxSamples; i++, p += wide ? 8 : 4) {
      offsets.push(wide ? Number(buf.readBigUInt64BE(p)) : buf.readUInt32BE(p));
    }
  }
  // Samples per chunk.
  const runs = [];
  {
    const { data } = fullBox(buf, stsc);
    const n = buf.readUInt32BE(data);
    for (let i = 0, p = data + 4; i < n && i < maxSamples; i++, p += 12) {
      runs.push({ firstChunk: buf.readUInt32BE(p), perChunk: buf.readUInt32BE(p + 4) });
    }
  }
  const samples = [];
  let sample = 0;
  let time = 0;
  for (let chunk = 0; chunk < offsets.length && sample < sizes.length; chunk++) {
    let perChunk = 0;
    for (const r of runs) if (r.firstChunk <= chunk + 1) perChunk = r.perChunk;
    let offset = offsets[chunk];
    for (let k = 0; k < perChunk && sample < sizes.length; k++, sample++) {
      samples.push({ offset, size: sizes[sample], start: time });
      time += durations[sample] || 0;
      offset += sizes[sample];
    }
  }
  return samples;
}

/** The video track's fragments, walked at the top level: the furthest decode time any of them reaches. */
function fragmentEnd(fd, topBoxes, video) {
  let end = 0;
  for (let i = 0; i < topBoxes.length; i++) {
    const top = topBoxes[i];
    if (top.type !== 'moof' || top.size > MAX_MOOF_BYTES) continue;
    // A fragment counts only with its data whole behind it: a crash cuts the file anywhere, and the top-level walk
    // lists no box that runs past the end, so a moof with no mdat after it is one whose frames were never finished.
    const next = topBoxes[i + 1];
    if (!next || next.type !== 'mdat') continue;
    const buf = Buffer.alloc(top.size);
    fs.readSync(fd, buf, 0, top.size, top.pos);
    const boxes = walk(buf, 0, top.size, 0, []);
    const moof = boxes[0];
    for (const traf of childrenOf(moof, 'traf')) {
      const tfhd = childOf(traf, 'tfhd');
      const tfdt = childOf(traf, 'tfdt');
      if (!tfhd) continue;
      const th = fullBox(buf, tfhd);
      const trackId = buf.readUInt32BE(th.data);
      if (trackId !== video.trackId) continue;
      let p = th.data + 4;
      if (th.flags & TFHD.BASE_DATA_OFFSET) p += 8;
      if (th.flags & TFHD.SAMPLE_DESC) p += 4;
      let defaultDuration = 0;
      if (th.flags & TFHD.DEFAULT_DURATION) { defaultDuration = buf.readUInt32BE(p); p += 4; }
      let base = 0;
      if (tfdt) {
        const td = fullBox(buf, tfdt);
        base = td.version === 1 ? Number(buf.readBigUInt64BE(td.data)) : buf.readUInt32BE(td.data);
      }
      let total = 0;
      for (const trun of childrenOf(traf, 'trun')) {
        const tr = fullBox(buf, trun);
        const count = buf.readUInt32BE(tr.data);
        let q = tr.data + 4;
        if (tr.flags & TRUN.DATA_OFFSET) q += 4;
        if (tr.flags & TRUN.FIRST_FLAGS) q += 4;
        if (tr.flags & TRUN.DURATION) {
          const per = (tr.flags & TRUN.SIZE ? 4 : 0) + (tr.flags & TRUN.FLAGS ? 4 : 0) + (tr.flags & TRUN.CTS ? 4 : 0);
          for (let i = 0; i < count; i++) { total += buf.readUInt32BE(q); q += 4 + per; }
        } else {
          total += count * defaultDuration;
        }
      }
      end = Math.max(end, base + total);
    }
  }
  return end;
}

function readMp4Info(file, { fs: fsModule = fs } = {}) {
  const none = (problem) => ({ layout: 'none', complete: false, durationMs: null, chapters: [], video: null, bytes: 0, problem });
  let fd;
  try {
    fd = fsModule.openSync(file, 'r');
  } catch (e) {
    return none(`could not be opened: ${e.message}`);
  }
  try {
    const size = fsModule.fstatSync(fd).size;
    const header = Buffer.alloc(16);
    const top = [];
    for (let pos = 0; pos + 8 <= size && top.length < MAX_TOP_BOXES;) {
      const got = fsModule.readSync(fd, header, 0, 16, pos);
      const h = readBoxHeader(header.subarray(0, got), 0, size - pos);
      if (!h) break;
      top.push({ type: h.type, pos, size: h.size, headerLen: h.headerLen });
      pos += h.size;
    }
    if (!top.length || top[0].type !== 'ftyp') return none('not an MP4 (no ftyp box first)');
    const moovTop = top.find((b) => b.type === 'moov');
    if (!moovTop) return { ...none('cut short: no moov box'), bytes: size };
    if (moovTop.size > MAX_MOOV_BYTES) return { ...none('the moov box is too large to read'), bytes: size };
    const moov = Buffer.alloc(moovTop.size);
    fsModule.readSync(fd, moov, 0, moovTop.size, moovTop.pos);
    const boxes = walk(moov, 0, moovTop.size, 0, []);
    const root = boxes[0];
    const mvhdBox = childOf(root, 'mvhd');
    if (!mvhdBox) return { ...none('no mvhd box'), bytes: size };
    const mvhd = readMvhd(moov, mvhdBox);
    const fragmented = !!childOf(root, 'mvex') && mvhd.duration === 0;

    let video = null;
    let chapterTrackId = null;
    const tracks = [];
    for (const trak of childrenOf(root, 'trak')) {
      const mdia = childOf(trak, 'mdia');
      const hdlr = childOf(mdia, 'hdlr');
      const mdhd = childOf(mdia, 'mdhd');
      const tkhd = childOf(trak, 'tkhd');
      if (!hdlr || !mdhd || !tkhd) continue;
      const t = { trackId: readTkhdId(moov, tkhd), handler: readHandler(moov, hdlr), timescale: readMdhd(moov, mdhd).timescale, stbl: childOf(childOf(mdia, 'minf'), 'stbl') };
      tracks.push(t);
      if (t.handler === 'vide' && !video) {
        video = { trackId: t.trackId, timescale: t.timescale };
        const chap = childOf(childOf(trak, 'tref'), 'chap');
        if (chap && chap.size >= chap.headerLen + 4) chapterTrackId = moov.readUInt32BE(chap.pos + chap.headerLen);
      }
    }

    const chapters = [];
    const textTrack = tracks.find((t) => t.trackId === chapterTrackId) || tracks.find((t) => t.handler === 'text');
    if (textTrack && textTrack.stbl && !fragmented) {
      const samples = readSamples(moov, textTrack.stbl);
      const name = Buffer.alloc(2);
      for (const s of samples) {
        if (s.size < 2 || s.offset + s.size > size) continue;
        fsModule.readSync(fd, name, 0, 2, s.offset);
        const len = Math.min(name.readUInt16BE(0), s.size - 2);
        const text = Buffer.alloc(len);
        if (len) fsModule.readSync(fd, text, 0, len, s.offset + 2);
        chapters.push({ name: text.toString('utf8'), ms: Math.round((s.start * 1000) / (textTrack.timescale || 1000)) });
        if (chapters.length >= MAX_CHAPTERS) break;
      }
    }

    if (!fragmented) {
      const durationMs = mvhd.timescale ? Math.round((mvhd.duration * 1000) / mvhd.timescale) : null;
      return { layout: 'final', complete: true, durationMs, chapters, video, bytes: size };
    }
    if (!video || !video.timescale) return { layout: 'fragmented', complete: false, durationMs: null, chapters: [], video, bytes: size, problem: 'no video track to measure' };
    const end = fragmentEnd(fd, top, video);
    return { layout: 'fragmented', complete: false, durationMs: Math.round((end * 1000) / video.timescale), chapters: [], video, bytes: size };
  } catch (e) {
    return none(`could not be read: ${e.message}`);
  } finally {
    try { fsModule.closeSync(fd); } catch (e) { /* closed */ }
  }
}

module.exports = { readMp4Info, readBoxHeader, walk, readSamples, MAX_MOOV_BYTES, MAX_CHAPTERS };
