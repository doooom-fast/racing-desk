// Small MP4 files built for the tests, in the two layouts OBS's Hybrid MP4 muxer writes (plugins/obs-outputs/mp4-mux.c
// in 32.1.2): a finished file — ftyp, mdat, and the full moov at the end with a chapter track — and an unfinished
// one — ftyp, a free placeholder, a fragmented moov with mvex, then moof + mdat pairs. The video is dummy bytes; only
// the boxes the reader (modules/js/obs/mp4-info.js) goes by are real.

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }
function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
function largeBox(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
  return Buffer.concat([u32(1), Buffer.from(type, 'latin1'), u64(16 + body.length), body]);
}
function fullbox(type, version, flags, ...parts) {
  const vf = Buffer.alloc(4);
  vf[0] = version;
  vf.writeUIntBE(flags, 1, 3);
  return box(type, vf, ...parts);
}

const ZERO = (n) => Buffer.alloc(n);
const CHAPTER_FOOTER = Buffer.alloc(12);   // OBS's CHAPTER_PKT_FOOTER: a styl box the reader does not need

function mvhd(timescale, duration) {
  return fullbox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), ZERO(10), ZERO(36), ZERO(24), u32(3));
}
function tkhd(id, duration) {
  return fullbox('tkhd', 0, 7, u32(0), u32(0), u32(id), u32(0), u32(duration), ZERO(8), u16(0), u16(0), u16(0), u16(0), ZERO(36), u32(0), u32(0));
}
function mdhd(timescale, duration) {
  return fullbox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
}
function hdlr(handler, name) {
  return fullbox('hdlr', 0, 0, u32(0), handler, ZERO(12), Buffer.from(name + '\0', 'latin1'));
}
function stts(deltas) {
  // One entry per run of equal deltas, as OBS writes it.
  const runs = [];
  for (const d of deltas) {
    if (runs.length && runs[runs.length - 1].delta === d) runs[runs.length - 1].count++;
    else runs.push({ delta: d, count: 1 });
  }
  return fullbox('stts', 0, 0, u32(runs.length), ...runs.flatMap((r) => [u32(r.count), u32(r.delta)]));
}
function stsc(runs) { return fullbox('stsc', 0, 0, u32(runs.length), ...runs.flatMap((r) => [u32(r.firstChunk), u32(r.perChunk), u32(1)])); }
function stsz(sizes) { return fullbox('stsz', 0, 0, u32(0), u32(sizes.length), Buffer.concat(sizes.map(u32))); }
function stco(offsets) { return fullbox('stco', 0, 0, u32(offsets.length), ...offsets.map(u32)); }
function co64(offsets) { return fullbox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64)); }
function stsdStub(entry) { return fullbox('stsd', 0, 0, u32(1), entry); }

function chapterSample(name) {
  const text = Buffer.from(name, 'utf8');
  return Buffer.concat([u16(text.length), text, CHAPTER_FOOTER]);
}

/**
 * A finished Hybrid MP4: ftyp, mdat (the chapter samples, then dummy video), moov at the end. `chapters` are
 * [{ ms, name }] in order; the last chapter runs to the end of the file, as OBS's dummy end marker makes it.
 * `withChapterTrack: false` leaves the chapter track out (a plain MP4); `large` writes the mdat with a 64-bit size.
 */
export function buildFinalMp4({ durationMs = 60000, chapters = [], fps = 60, withChapterTrack = true, large = false, chapterRef = true } = {}) {
  const videoTimescale = 60000;
  const samples = chapters.map((c) => chapterSample(c.name));
  const chapterBytes = Buffer.concat(samples);
  const video = Buffer.alloc(4096, 0x11);
  const mdatBody = Buffer.concat([chapterBytes, video]);
  const ftyp = box('ftyp', 'isom', u32(0x200), 'isom', 'iso6', 'iso2', 'avc1', 'mp41');
  const mdat = large ? largeBox('mdat', mdatBody) : box('mdat', mdatBody);
  const mdatDataAt = ftyp.length + (large ? 16 : 8);
  const videoAt = mdatDataAt + chapterBytes.length;
  const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const videoTrak = box('trak',
    tkhd(1, durationMs),
    ...(withChapterTrack && chapterRef ? [box('tref', box('chap', u32(2)))] : []),
    box('mdia',
      mdhd(videoTimescale, Math.round((durationMs / 1000) * videoTimescale)),
      hdlr('vide', 'VideoHandler'),
      box('minf', box('stbl',
        stsdStub(box('avc1', ZERO(78))),
        stts([videoTimescale / fps].concat(Array(frames - 1).fill(videoTimescale / fps))),
        stsc([{ firstChunk: 1, perChunk: frames }]),
        stsz(Array(frames).fill(16)),
        stco([videoAt]),
      )),
    ),
  );
  let textTrak = null;
  if (withChapterTrack && chapters.length) {
    const deltas = chapters.map((c, i) => (i + 1 < chapters.length ? chapters[i + 1].ms - c.ms : durationMs - c.ms));
    textTrak = box('trak',
      tkhd(2, durationMs),
      box('mdia',
        mdhd(1000, durationMs),
        hdlr('text', 'ChapterHandler'),
        box('minf', box('stbl',
          stsdStub(box('text', ZERO(8))),
          stts(deltas),
          stsc([{ firstChunk: 1, perChunk: chapters.length }]),
          stsz(samples.map((s) => s.length)),
          large ? co64([mdatDataAt]) : stco([mdatDataAt]),
        )),
      ),
    );
  }
  const moov = box('moov', mvhd(1000, durationMs), videoTrak, ...(textTrak ? [textTrak] : []));
  return Buffer.concat([ftyp, mdat, moov]);
}

/**
 * A Hybrid MP4 OBS never finalised: ftyp, the 16-byte free placeholder, the fragmented moov (duration 0, mvex), then
 * a moof + mdat for each of `fragments` ([{ samples, sampleDuration }] in the video track's timescale). `perSample`
 * writes each sample's duration in the trun instead of a default in the tfhd.
 */
export function buildFragmentedMp4({ fragments = [{ samples: 60, sampleDuration: 1000 }], timescale = 60000, perSample = false } = {}) {
  const ftyp = box('ftyp', 'iso6', u32(0x200), 'isom', 'iso6', 'iso2', 'avc1', 'mp41');
  const free = box('free', ZERO(8));
  const moov = box('moov',
    mvhd(1000, 0),
    box('trak',
      tkhd(1, 0),
      box('mdia', mdhd(timescale, 0), hdlr('vide', 'VideoHandler'),
        box('minf', box('stbl', stsdStub(box('avc1', ZERO(78))), fullbox('stts', 0, 0, u32(0)), fullbox('stsc', 0, 0, u32(0)), fullbox('stsz', 0, 0, u32(0), u32(0)), fullbox('stco', 0, 0, u32(0)))))),
    box('mvex', fullbox('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0))),
  );
  const parts = [ftyp, free, moov];
  let base = 0;
  let seq = 1;
  for (const f of fragments) {
    const size = 16;
    const data = Buffer.alloc(f.samples * size, 0x22);
    const tfhdFlags = 0x1 | 0x10 | 0x20 | (perSample ? 0 : 0x8);
    const tfhdBox = fullbox('tfhd', 0, tfhdFlags, u32(1), u64(0), ...(perSample ? [] : [u32(f.sampleDuration)]), u32(size), u32(0x01010000));
    const tfdtBox = fullbox('tfdt', 1, 0, u64(base));
    const trunFlags = 0x1 | 0x4 | 0x800 | (perSample ? 0x100 : 0);
    const perSampleFields = [];
    for (let i = 0; i < f.samples; i++) {
      if (perSample) perSampleFields.push(u32(f.sampleDuration));
      perSampleFields.push(u32(0));   // composition offset
    }
    const trunBox = fullbox('trun', 0, trunFlags, u32(f.samples), u32(0), u32(0x02000000), ...perSampleFields);
    const moof = box('moof', fullbox('mfhd', 0, 0, u32(seq++)), box('traf', tfhdBox, tfdtBox, trunBox));
    parts.push(moof, box('mdat', data));
    base += f.samples * f.sampleDuration;
  }
  return Buffer.concat(parts);
}
