// Phase 0 probe: scan every .ibt header in the telemetry folder (no frame data read).
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIbtHeader, yamlField } from './ibt-inspect.mjs';

const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith('.ibt'));
const rows = [], errors = [];
const varSets = new Map(); // signature -> {names, first, last, count}
const t0 = Date.now();
for (const f of files) {
  try {
    const h = readIbtHeader(join(dir, f));
    const y = h.yaml;
    const names = h.vars.map(v => v.name);
    const sig = names.join(',');
    const date = new Date(h.sessionStartDate * 1000).toISOString();
    const vs = varSets.get(sig) ?? { names, first: date, last: date, count: 0 };
    if (date < vs.first) vs.first = date; if (date > vs.last) vs.last = date; vs.count++;
    varSets.set(sig, vs);
    rows.push({
      file: f, date, bytes: statSync(join(dir, f)).size, records: h.recordCount, laps: h.lapCount,
      trackId: yamlField(y, 'TrackID'), track: yamlField(y, 'TrackName'), cfg: yamlField(y, 'TrackConfigName'),
      event: yamlField(y, 'EventType'), official: yamlField(y, 'Official'), seriesId: yamlField(y, 'SeriesID'),
      subSessionId: yamlField(y, 'SubSessionID'),
      drivers: (y.match(/^\s*- CarIdx: /gm) || []).length,
      irated: [...y.matchAll(/IRating: (\d+)/g)].filter(m => +m[1] > 0).length,
      results: (y.match(/^\s*- Position: /gm) || []).length,
      sectors: (y.match(/SectorNum/g) || []).length,
      hasLatLon: names.includes('Lat') && names.includes('Lon'),
      carIdx: names.filter(n => n.startsWith('CarIdx')).length,
    });
  } catch (e) { errors.push({ file: f, error: e.message }); }
}
const ms = Date.now() - t0;
const by = (k) => rows.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
const uniq = (fn) => new Set(rows.map(fn)).size;
const summary = {
  files: files.length, parsed: rows.length, errors: errors.length, scanMs: ms,
  dateRange: [rows.map(r => r.date).sort()[0], rows.map(r => r.date).sort().at(-1)],
  eventTypes: by('event'), official: by('official'),
  distinctTrackIds: uniq(r => r.trackId), distinctLayouts: uniq(r => `${r.track}|${r.cfg}`),
  distinctSubsessions: uniq(r => r.subSessionId),
  withLatLon: rows.filter(r => r.hasLatLon).length,
  withCarIdxArrays: rows.filter(r => r.carIdx > 0).length,
  withSectors: rows.filter(r => r.sectors > 0).length,
  raceFilesWithGridIRatings: rows.filter(r => r.event === 'Race' && r.irated > 1).length,
  raceFilesWithResults: rows.filter(r => r.event === 'Race' && r.results > 0).length,
  medianRaceGrid: (() => { const g = rows.filter(r => r.event === 'Race').map(r => r.irated).sort((a, b) => a - b); return g[g.length >> 1]; })(),
  zeroLapFiles: rows.filter(r => r.laps === 0).length,
  varSchemas: [...varSets.values()].map(v => ({ count: v.count, numVars: v.names.length, first: v.first, last: v.last })),
};
// Vars that appear in newer schemas but not the oldest one.
const schemas = [...varSets.values()].sort((a, b) => a.first.localeCompare(b.first));
if (schemas.length > 1) {
  const base = new Set(schemas[0].names);
  summary.varsAddedSinceOldest = schemas.slice(1).map(s => ({ from: s.first, added: s.names.filter(n => !base.has(n)), removed: schemas[0].names.filter(n => !s.names.includes(n)) }));
}
console.log(JSON.stringify(summary, null, 2));
if (errors.length) console.log('errors (first 5):', errors.slice(0, 5));
writeFileSync(new URL('./ibt-scan.json', import.meta.url), JSON.stringify({ summary, rows, errors }, null, 1));
