// The telemetry sidecar: one JSON line per frame beside a recording — `<video>.telemetry.jsonl` — with a header
// first and a summary last (docs/telemetry-sidecar-schema.md). It is what the editor cuts by: where the overtakes,
// incidents, laps and pit stops are, and what the car was doing frame by frame.
//
// Pure, and written by the main process, not the HUD's page (modules/js/obs/recording.js polls the telemetry at
// 30 Hz while OBS records): a page reload, the HUD switched off or the garage used to stop the frames. The writer
// is handed in — write(path, text) — so the rules run in Node (tests/unit/telemetry-sidecar.spec.mjs).
//
// What changed with OBS (schemaVersion stays 1; all additive, and a reader that defaults a missing field to 0 is
// right): every frame carries the sim's own clock, `sn` (SessionNum) and `st` (SessionTime), which is how a moment
// in the sidecar is found again in iRacing's replay; the header says who produced it (`producer: "obs"`), the OBS
// file (`obsOutputPath`), when the video began (`videoStartUtc`) and the offset to add to `t` (`videoOffsetMs`,
// 0 until a better one is read back from the finished file); `flag` is the payload's one word, `currentFlagState`
// (`DS.FlagState`, which it read before, was never sent, so every frame said "green"); `gear` is the string the
// HUD shows ("N", "R", "3": it used to turn "N" into 0); `closestCar` is no longer written (`DS.ClosestCarDistance`
// was never sent either).
const SCHEMA_VERSION = 1;
const FLUSH_EVERY = 30;   // frames: a write a second at 30 Hz

const KEYS = Object.freeze({
  demoMode: 'RacingDesk.Plugin.DemoMode',
  gameId: 'RacingDesk.Plugin.GameId',
  sessionNum: 'DataCorePlugin.GameRawData.Telemetry.SessionNum',
  sessionTime: 'DataCorePlugin.GameRawData.Telemetry.SessionTime',
  flag: 'currentFlagState',
});

function flag(value) {
  if (value === true) return true;
  if (typeof value === 'string' && /^true$/i.test(value.trim())) return true;
  return Number(value) > 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * createSidecar({ write, now })
 *   start({ path, startedAt, producer, obsOutputPath, videoOffsetMs, resume })
 *                               resume: the file has frames already (Racing Desk was restarted mid-recording, or lost
 *                               OBS for a while): a `resumed` line is written in place of a second header, and the
 *                               frames after it are numbered from 0 again, with `t` still from the video's start
 *   frame(payload)              one line, from the payload the HUD reads; the header is written with the first
 *   marker({ type, ... })       a marker of the caller's (a file change, a chapter)
 *   stop({ stoppedAt, reason })  flush, the summary line, and done
 *   flush(), isActive(), state()
 */
function createSidecar({ write, now = Date.now, flushEvery = FLUSH_EVERY } = {}) {
  if (typeof write !== 'function') throw new Error('createSidecar needs write(path, text)');
  let active = false;
  let path = null;
  let startedAt = 0;
  let header = null;         // the header's fields until it is written
  let headerWritten = false;
  let resumed = false;
  let frameIndex = 0;
  let buffer = [];
  let markers = [];
  let prevIncidents = -1;
  let prevPosition = -1;
  let prevLap = -1;
  let prevInPit = null;

  function line(obj) {
    buffer.push(JSON.stringify(obj));
  }

  function flush() {
    if (!buffer.length || !path) return;
    const chunk = buffer.join('\n') + '\n';
    buffer = [];
    write(path, chunk);
  }

  // Written at once, by itself, so the file is there from the first frame; the frames are buffered behind it.
  function writeHeader(p) {
    if (headerWritten) return;
    headerWritten = true;
    const isDemo = !!p && flag(p[KEYS.demoMode]);
    const pick = (game, demo) => (p ? (isDemo ? (p[demo] || p[game]) : (p[game] || p[demo])) || null : null);
    const car = pick('DataCorePlugin.GameData.CarModel', 'RacingDesk.Plugin.Demo.CarModel');
    const track = pick('DataCorePlugin.GameData.TrackName', 'RacingDesk.Plugin.Demo.TrackName');
    write(path, JSON.stringify({
      _type: 'header',
      schemaVersion: SCHEMA_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      car: car === undefined ? null : car,
      track: track === undefined ? null : track,
      gameId: p && p[KEYS.gameId] ? String(p[KEYS.gameId]) : null,
      isDemo,
      producer: header.producer,
      obsOutputPath: header.obsOutputPath,
      videoStartUtc: new Date(startedAt).toISOString(),
      videoOffsetMs: header.videoOffsetMs,
    }) + '\n');
  }

  function start({ path: file, startedAt: at = now(), producer = 'obs', obsOutputPath = null, videoOffsetMs = 0, resume = false } = {}) {
    if (active) stop({ reason: 'started again' });
    if (typeof file !== 'string' || !file) throw new Error('a sidecar needs a path');
    active = true;
    path = file;
    startedAt = at;
    header = { producer, obsOutputPath, videoOffsetMs };
    // A file that already has its header is not given a second: the editor reads one header first and a summary last.
    headerWritten = !!resume;
    resumed = !!resume;
    frameIndex = 0;
    buffer = [];
    markers = [];
    prevIncidents = -1;
    prevPosition = -1;
    prevLap = -1;
    prevInPit = null;
    if (resume) {
      line({ _type: 'resumed', schemaVersion: SCHEMA_VERSION, resumedAt: new Date(now()).toISOString(), t: +((now() - at) / 1000).toFixed(3) });
    }
  }

  function frame(p, { at = now() } = {}) {
    if (!active || !p || typeof p !== 'object') return false;
    if (!headerWritten) writeHeader(p);
    const isDemo = flag(p[KEYS.demoMode]);
    const dsPre = isDemo ? 'RacingDesk.Plugin.Demo.DS.' : 'RacingDesk.Plugin.DS.';
    const gridPre = isDemo ? 'RacingDesk.Plugin.Demo.Grid.' : 'RacingDesk.Plugin.Grid.';
    const v = (k) => (p[k] != null ? p[k] : 0);
    const vs = (k) => (p[k] != null ? '' + p[k] : '');
    const n = (k) => +v(k) || 0;
    const game = (k, demoK) => (isDemo ? n('RacingDesk.Plugin.Demo.' + demoK) : n('DataCorePlugin.GameData.' + k));

    const elapsedMs = at - startedAt;
    const pos = isDemo ? n('RacingDesk.Plugin.Demo.Position') : n('DataCorePlugin.GameData.Position');
    const incidents = n(dsPre + 'IncidentCount');
    const lap = isDemo ? n('RacingDesk.Plugin.Demo.CurrentLap') : n('DataCorePlugin.GameData.CurrentLap');
    const inPit = n(dsPre + 'IsInPitLane') > 0;
    const t = +(elapsedMs / 1000).toFixed(3);

    // ── Markers ──
    if (prevIncidents >= 0 && incidents > prevIncidents) markers.push({ type: 'incident', frame: frameIndex, t: elapsedMs, from: prevIncidents, to: incidents });
    if (prevPosition > 0 && pos > 0 && pos !== prevPosition) markers.push({ type: 'position_change', frame: frameIndex, t: elapsedMs, from: prevPosition, to: pos, direction: pos < prevPosition ? 'gained' : 'lost' });
    if (prevLap > 0 && lap > prevLap) markers.push({ type: 'new_lap', frame: frameIndex, t: elapsedMs, lap });
    if (prevInPit !== null && prevInPit !== inPit) markers.push({ type: inPit ? 'pit_entry' : 'pit_exit', frame: frameIndex, t: elapsedMs });
    prevIncidents = incidents;
    prevPosition = pos;
    prevLap = lap;
    prevInPit = inPit;

    const gearRaw = isDemo ? p['RacingDesk.Plugin.Demo.Gear'] : p['DataCorePlugin.GameData.Gear'];
    const sessionNum = numberOrNull(p[KEYS.sessionNum]);
    const sessionTime = numberOrNull(p[KEYS.sessionTime]);

    const row = {
      t,
      frame: frameIndex,
      // The sim's own clock, for finding this moment in iRacing's replay. Absent where the sim did not say.
      ...(sessionNum !== null ? { sn: sessionNum } : {}),
      ...(sessionTime !== null ? { st: +sessionTime.toFixed(3) } : {}),
      // Position & gaps
      pos,
      totalCars: n(gridPre + 'TotalCars'),
      gapAhead: isDemo ? n('RacingDesk.Plugin.Demo.GapAhead') : n('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap'),
      gapBehind: isDemo ? n('RacingDesk.Plugin.Demo.GapBehind') : n('IRacingExtraProperties.iRacing_Opponent_Behind_Gap'),
      // Lap & sector
      lap,
      sector: n(dsPre + 'CurrentSector'),
      lapDelta: n(dsPre + 'LapDelta'),
      // Speed & inputs
      speed: game('SpeedMph', 'SpeedMph'),
      throttle: game('Throttle', 'Throttle'),
      brake: game('Brake', 'Brake'),
      gear: gearRaw == null ? '' : String(gearRaw),
      steer: n('DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle'),
      // G-forces
      latG: n(dsPre + 'LatG'),
      longG: n(dsPre + 'LongG'),
      // Incidents & flags
      incidents,
      flag: vs(KEYS.flag) || 'none',
      // Pit status
      pit: inPit,
      // Fuel
      fuel: game('Fuel', 'Fuel'),
      maxFuel: game('MaxFuel', 'MaxFuel'),
      fuelLap: isDemo ? n('RacingDesk.Plugin.Demo.FuelPerLap') : n('DataCorePlugin.Computed.Fuel_LitersPerLap'),
      remLaps: game('RemainingLaps', 'RemainingLaps'),
      // Tyre temps and wear
      tFL: game('TyreTempFrontLeft', 'TyreTempFL'), tFR: game('TyreTempFrontRight', 'TyreTempFR'),
      tRL: game('TyreTempRearLeft', 'TyreTempRL'), tRR: game('TyreTempRearRight', 'TyreTempRR'),
      wFL: game('TyreWearFrontLeft', 'TyreWearFL'), wFR: game('TyreWearFrontRight', 'TyreWearFR'),
      wRL: game('TyreWearRearLeft', 'TyreWearRL'), wRR: game('TyreWearRearRight', 'TyreWearRR'),
      // In-car adjustments
      bb: isDemo ? n('RacingDesk.Plugin.Demo.BrakeBias') : n('DataCorePlugin.GameRawData.Telemetry.dcBrakeBias'),
      tc: isDemo ? n('RacingDesk.Plugin.Demo.TC') : n('DataCorePlugin.GameRawData.Telemetry.dcTractionControl'),
      abs: isDemo ? n('RacingDesk.Plugin.Demo.ABS') : n('DataCorePlugin.GameRawData.Telemetry.dcABS'),
      // Session
      sessionState: n(gridPre + 'SessionState'),
      endOfRace: n(dsPre + 'IsEndOfRace') > 0,
    };
    line(row);
    frameIndex++;
    if (buffer.length >= flushEvery) flush();
    return true;
  }

  function marker(m, { at = now() } = {}) {
    if (!active || !m || typeof m !== 'object' || !m.type) return false;
    markers.push({ ...m, frame: frameIndex, t: at - startedAt });
    return true;
  }

  function stop({ stoppedAt = now(), reason = null, obsOutputPath = null } = {}) {
    if (!active) return null;
    if (!headerWritten) writeHeader(null);
    const summary = {
      _type: 'summary',
      frames: frameIndex,
      durationMs: Math.max(0, stoppedAt - startedAt),
      markers,
      stoppedAt: new Date(stoppedAt).toISOString(),
      obsOutputPath: obsOutputPath || header.obsOutputPath,
    };
    if (reason) summary.reason = reason;
    if (resumed) summary.resumed = true;
    line(summary);
    flush();
    const result = { path, frames: frameIndex, markers: markers.length };
    active = false;
    path = null;
    header = null;
    return result;
  }

  function state() {
    return { active, path, frames: frameIndex, markers: markers.length, startedAt };
  }

  return { start, frame, marker, stop, flush, isActive: () => active, state };
}

/** The sidecar's path for a video file: the same name with .telemetry.jsonl in place of the extension. */
function sidecarPathFor(videoPath) {
  return String(videoPath).replace(/\.[a-z0-9]{2,5}$/i, '') + '.telemetry.jsonl';
}

module.exports = { SCHEMA_VERSION, FLUSH_EVERY, KEYS, createSidecar, sidecarPathFor };
