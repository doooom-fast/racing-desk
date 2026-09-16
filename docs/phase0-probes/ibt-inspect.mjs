// Phase 0 probe: read an .ibt header, var table and session YAML (irsdk disk format).
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readIbtHeader(path, { withYaml = true } = {}) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const h = Buffer.alloc(144);
    readSync(fd, h, 0, 144, 0);
    const hdr = {
      ver: h.readInt32LE(0), tickRate: h.readInt32LE(8),
      sessionInfoLen: h.readInt32LE(16), sessionInfoOffset: h.readInt32LE(20),
      numVars: h.readInt32LE(24), varHeaderOffset: h.readInt32LE(28),
      numBuf: h.readInt32LE(32), bufLen: h.readInt32LE(36),
      bufOffset: h.readInt32LE(52),
      sessionStartDate: Number(h.readBigInt64LE(112)),
      sessionStartTime: h.readDoubleLE(120), sessionEndTime: h.readDoubleLE(128),
      lapCount: h.readInt32LE(136), recordCount: h.readInt32LE(140),
      fileSize: size,
    };
    const vb = Buffer.alloc(hdr.numVars * 144);
    readSync(fd, vb, 0, vb.length, hdr.varHeaderOffset);
    const cstr = (b, o, n) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString('latin1'); };
    hdr.vars = [];
    for (let i = 0; i < hdr.numVars; i++) {
      const o = i * 144;
      hdr.vars.push({ type: vb.readInt32LE(o), offset: vb.readInt32LE(o + 4), count: vb.readInt32LE(o + 8),
        name: cstr(vb, o + 16, 32), desc: cstr(vb, o + 48, 64), unit: cstr(vb, o + 112, 32) });
    }
    if (withYaml) {
      const yb = Buffer.alloc(hdr.sessionInfoLen);
      readSync(fd, yb, 0, yb.length, hdr.sessionInfoOffset);
      hdr.yaml = cstr(yb, 0, yb.length);
    }
    return hdr;
  } finally { closeSync(fd); }
}

// Minimal YAML field grab — irsdk YAML is flat enough for regex on known keys.
export const yamlField = (yaml, key) => { const m = yaml.match(new RegExp(`^\\s*${key}: (.*)$`, 'm')); return m ? m[1].trim() : null; };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const hdr = readIbtHeader(process.argv[2]);
  const { vars, yaml, ...rest } = hdr;
  console.log(rest);
  console.log(`\n${vars.length} vars. Types 0=char 1=bool 2=int 3=bitfield 4=float 5=double`);
  const pick = /^(Lat|Lon|Alt|LapDist|LapDistPct|VelocityX|VelocityY|Yaw|YawNorth|Speed|Lap|CarIdx|Fuel|PlayerCarMyIncidentCount|PlayerCarTeamIncidentCount|PlayerCarDriverIncidentCount|SessionTime|SessionNum|PlayerTrackSurface|dcPitSpeedLimiterToggle|LapLastLapTime|LapBestLapTime)/;
  for (const v of vars) if (pick.test(v.name)) console.log(`  ${v.name.padEnd(32)} t=${v.type} n=${String(v.count).padEnd(3)} ${v.unit.padEnd(8)} ${v.desc}`);
  console.log(`\nCarIdx* arrays: ${vars.filter(v => v.name.startsWith('CarIdx')).map(v => `${v.name}[${v.count}]`).join(', ') || '(none)'}`);
  console.log('\nTop-level YAML sections:', [...yaml.matchAll(/^([A-Za-z]+):/gm)].map(m => m[1]).join(', '));
  for (const k of ['TrackName', 'TrackID', 'TrackConfigName', 'TrackDisplayName', 'TrackLength', 'SeriesID', 'SeasonID', 'SessionID', 'SubSessionID', 'EventType', 'Official', 'RaceWeek', 'NumCarClasses', 'TrackNumTurns'])
    console.log(`  ${k}: ${yamlField(yaml, k)}`);
  const drivers = [...yaml.matchAll(/^\s*- CarIdx: (\d+)[\s\S]*?IRating: (-?\d+)/gm)];
  console.log(`  DriverInfo entries with IRating: ${drivers.length}`);
  const split = yaml.match(/SplitTimeInfo:[\s\S]*?(?=\n[A-Za-z]+:)/);
  console.log(`  SplitTimeInfo sectors: ${split ? (split[0].match(/SectorNum/g) || []).length : 'absent'}`);
  console.log(`  SessionInfo types: ${[...yaml.matchAll(/SessionType: (.*)/g)].map(m => m[1]).join(' | ')}`);
}
