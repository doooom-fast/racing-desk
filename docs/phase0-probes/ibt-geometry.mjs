// Phase 0 probe: derive a track outline from the user's own .ibt Lat/Lon, validate against YAML TrackLength.
import { openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readIbtHeader, yamlField } from './ibt-inspect.mjs';

const path = process.argv[2];
const out = process.argv[3];
const t0 = Date.now();
const h = readIbtHeader(path);
// ~5 m per LapDistPct bin (min 1000) so long layouts don't lose length to chord-cutting.
const N = +process.env.BINS || Math.max(1000, Math.round(parseFloat(yamlField(h.yaml, 'TrackLength')) * 1000 / 5));
const v = Object.fromEntries(h.vars.map(x => [x.name, x]));
const need = ['Lat', 'Lon', 'Alt', 'LapDistPct', 'Lap', 'PlayerTrackSurface', 'OnPitRoad'];
for (const n of need) if (!v[n]) throw new Error(`missing var ${n}`);
const rd = (buf, o, x) => ({ 1: () => buf.readUInt8(o + x.offset), 2: () => buf.readInt32LE(o + x.offset), 4: () => buf.readFloatLE(o + x.offset), 5: () => buf.readDoubleLE(o + x.offset) })[x.type]();

// Read frames in chunks, bucket by lap.
const laps = new Map();
const fd = openSync(path, 'r');
const CH = 4096, buf = Buffer.alloc(CH * h.bufLen);
for (let i = 0; i < h.recordCount; i += CH) {
  const n = Math.min(CH, h.recordCount - i);
  const got = readSync(fd, buf, 0, n * h.bufLen, h.bufOffset + i * h.bufLen);
  for (let k = 0; k < Math.floor(got / h.bufLen); k++) {
    const o = k * h.bufLen;
    const lap = rd(buf, o, v.Lap);
    const s = { lat: rd(buf, o, v.Lat), lon: rd(buf, o, v.Lon), alt: rd(buf, o, v.Alt), pct: rd(buf, o, v.LapDistPct), surf: rd(buf, o, v.PlayerTrackSurface), pit: rd(buf, o, v.OnPitRoad) };
    if (!laps.has(lap)) laps.set(lap, []);
    laps.get(lap).push(s);
  }
}
closeSync(fd);

// A clean lap: fully on track (surface 3), never on pit road, covers 0→1 monotonically.
const clean = [];
for (const [lap, ss] of laps) {
  if (ss.length < 600) continue;
  if (ss.some(s => s.surf !== 3 || s.pit)) continue;
  if (ss[0].pct > 0.01 || ss.at(-1).pct < 0.99) continue;
  let back = 0; for (let i = 1; i < ss.length; i++) if (ss[i].pct < ss[i - 1].pct - 1e-4) back++;
  if (back > 2) continue;
  if (ss.some(s => s.lat === 0 && s.lon === 0)) continue;
  clean.push({ lap, ss });
}
if (!clean.length) throw new Error(`no clean laps among ${laps.size}`);

// Local equirectangular projection (metres) around the first sample.
const R = 6371008.8, D = Math.PI / 180;
const lat0 = clean[0].ss[0].lat, lon0 = clean[0].ss[0].lon, kx = Math.cos(lat0 * D) * R * D, ky = R * D;
const resample = (ss) => {
  const pts = new Array(N); let j = 0;
  for (let b = 0; b < N; b++) {
    const p = b / N;
    while (j < ss.length - 2 && ss[j + 1].pct < p) j++;
    const a = ss[j], c = ss[j + 1], t = c.pct === a.pct ? 0 : Math.min(1, Math.max(0, (p - a.pct) / (c.pct - a.pct)));
    pts[b] = { x: ((a.lon + (c.lon - a.lon) * t) - lon0) * kx, y: ((a.lat + (c.lat - a.lat) * t) - lat0) * ky, z: a.alt + (c.alt - a.alt) * t };
  }
  return pts;
};
const traces = clean.map(l => resample(l.ss));
const mean = Array.from({ length: N }, (_, b) => ({
  x: traces.reduce((s, t) => s + t[b].x, 0) / traces.length,
  y: traces.reduce((s, t) => s + t[b].y, 0) / traces.length,
  z: traces.reduce((s, t) => s + t[b].z, 0) / traces.length,
}));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let len = 0; for (let b = 0; b < N; b++) len += dist(mean[b], mean[(b + 1) % N]);
const spread = mean.map((m, b) => Math.sqrt(traces.reduce((s, t) => s + dist(t[b], m) ** 2, 0) / traces.length));
const closure = dist(mean[N - 1], mean[0]) / (len / N);
const zs = mean.map(m => m.z);

// SVG in the same 0–100 / 5% padding convention as TrackMapProvider, north-up.
const xs = mean.map(m => m.x), ys = mean.map(m => -m.y);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const scale = 90 / Math.max(maxX - minX, maxY - minY);
const ox = 5 + (90 - (maxX - minX) * scale) / 2, oy = 5 + (90 - (maxY - minY) * scale) / 2;
const P = (b) => [(xs[b] - minX) * scale + ox, (ys[b] - minY) * scale + oy];
const d = mean.map((_, b) => `${b ? 'L' : 'M'}${P(b)[0].toFixed(2)},${P(b)[1].toFixed(2)}`).join('') + 'Z';
const sectorPcts = [...h.yaml.matchAll(/SectorStartPct: ([\d.]+)/g)].map(m => +m[1]);
const ticks = sectorPcts.map(p => { const [x, y] = P(Math.round(p * N) % N); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.9" fill="#e5484d"/>`; }).join('');
if (out) writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="600" height="600"><rect width="100" height="100" fill="#111"/><path d="${d}" fill="none" stroke="#eee" stroke-width="0.6" stroke-linejoin="round"/>${ticks}</svg>`);

const yamlLen = parseFloat(yamlField(h.yaml, 'TrackLength')) * 1000;
console.log(JSON.stringify({
  file: basename(path), track: yamlField(h.yaml, 'TrackDisplayName'), config: yamlField(h.yaml, 'TrackConfigName'),
  bins: N, lapsInFile: laps.size, cleanLaps: clean.length,
  derivedLengthM: Math.round(len), yamlTrackLengthM: yamlLen, lengthErrorPct: +((len - yamlLen) / yamlLen * 100).toFixed(2),
  closureGapInBinSpacings: +closure.toFixed(2),
  lateralSpreadM: { median: +spread.slice().sort((a, b) => a - b)[N >> 1].toFixed(2), p95: +spread.slice().sort((a, b) => a - b)[Math.floor(N * 0.95)].toFixed(2) },
  elevationRangeM: +(Math.max(...zs) - Math.min(...zs)).toFixed(1),
  sectors: sectorPcts.length, svgPathBytes: d.length, elapsedMs: Date.now() - t0,
}, null, 2));
