/**
 * Made-up frames of the plugin's payload for the tests that need a field, a circuit and a race — the leaderboard, the
 * maps, the sparklines, the glance layout. The circuit is nobody's track and the entrants are NATO-alphabet
 * surnames, so nothing here is anyone's; the driver is "Test Driver", flagged in the leaderboard as the player.
 *
 * A frame is the golden fixture's full payload with the unit tests' in-car telemetry over it, and then what the
 * caller says: who is where, in which session, at which flag.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_TELEMETRY } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASE = JSON.parse(fs.readFileSync(path.join(here, 'golden', 'fixtures', 'base-payload.json'), 'utf8'));

// A synthetic circuit: 240 points evenly spaced in lap fraction, in the plugin's 0-100 space.
const N = 240;
const POINTS = [];
for (let i = 0; i < N; i++) {
  const t = (i / N) * Math.PI * 2;
  POINTS.push([50 + 36 * Math.cos(t) + 6 * Math.cos(3 * t), 50 + 26 * Math.sin(t) - 8 * Math.sin(2 * t)]);
}
export const SVG_PATH = 'M ' + POINTS.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z';

// Where a car at this fraction of the lap is, and which way it faces.
export function at(pct) {
  const f = (((pct % 1) + 1) % 1) * N;
  const i = Math.floor(f) % N;
  const j = (i + 1) % N;
  const k = f - Math.floor(f);
  const [x0, y0] = POINTS[i];
  const [x1, y1] = POINTS[j];
  return {
    x: x0 + (x1 - x0) * k,
    y: y0 + (y1 - y0) * k,
    heading: ((Math.atan2(x1 - x0, -(y1 - y0)) * 180) / Math.PI + 360) % 360,
  };
}

export const ME = 'Test Driver';
export const FIELD = ['Alex Alpha', 'Blake Bravo', 'Casey Charlie', 'Dana Delta', 'Eli Echo', 'Finn Foxtrot',
  'Gale Golf', 'Harper Hotel', 'Indy India', 'Jules Juliet', 'Kai Kilo', 'Lee Lima', 'Max Mike', 'Nat November',
  'Oli Oscar', 'Pat Papa', 'Quin Quebec', 'Rae Romeo', 'Sam Sierra', 'Tay Tango'];

// The field with the driver at a place: 1 is the front.
export function fieldWith(place, others = FIELD) {
  const order = others.slice();
  order.splice(Math.max(0, Math.min(order.length, place - 1)), 0, ME);
  return order;
}

/**
 * One frame. `order` is the running order, names first to last, ME among them.
 *   session   the session's type name ('Race', 'Practice', 'Qualify')
 *   mode      DS.SessionMode: 1 practice, 2 qualifying, 3 warm-up, 4 race
 *   state     Grid.SessionState: 1 get in car, 2 warm-up, 3 parade laps, 4 racing, 5 chequered, 6 cool-down
 *   start     DS.StartPosition, what the host kept as his grid slot (0: none yet)
 *   noPlaces  the sim gives no place for the first seconds after the green: he and the field have none
 *   lastLaps  { name: seconds } to override a car's last lap
 *   controls  the car's controls key (car-controls-wire.json), or none
 *   flag      currentFlagState: none, green, yellow, blue, white, checkered, black, meatball, red, debris
 *   lapDelta  DS.LapDelta, iRacing's gap to his best lap ever at the track
 */
export function frame({
  order, lap = 5, session = 'Race', mode = 4, state = 4, start = 0, playerPct = 0.3, lastLaps = {}, lapDelta = 0.412,
  incidents = 4, curLapTime = 41.2, track = 'synthetic_circuit', noPlaces = false, controls = null, totalLaps = 20,
  flag = 'none', fuelLaps = 9.1,
} = {}) {
  const me = order.indexOf(ME) + 1;
  const pcts = {};
  order.forEach((name, i) => { pcts[name] = playerPct + (me - 1 - i) * 0.035; });
  const board = order.map((name, i) => {
    const last = lastLaps[name] ?? +(92 + ((name.length * 37 + lap * 13 + i * 7) % 90) / 100).toFixed(3);
    // [place, name, iRating, best lap, last lap, gap to the driver (negative: ahead of him), in pit, is the driver]
    return [noPlaces ? 0 : i + 1, name, 1500 + ((i * 331) % 2400), +(last - 0.3).toFixed(3), last,
      name === ME ? 0 : +((pcts[ME] - pcts[name]) * 92).toFixed(2), 0, name === ME ? 1 : 0];
  });
  const p = at(playerPct);
  const others = order.filter((n) => n !== ME).map((n) => {
    const o = at(pcts[n]);
    return `${o.x.toFixed(1)},${o.y.toFixed(1)},0`;
  }).join(';');
  const short = (name) => { if (!name) return ''; const [a, b] = name.split(' '); return `${a[0]}. ${b}`; };
  const payload = {
    ...BASE,
    ...MOCK_TELEMETRY,
    'RacingDesk.Plugin.SessionTypeName': session,
    'RacingDesk.Plugin.Grid.SessionState': state,
    'RacingDesk.Plugin.DS.SessionMode': mode,
    'RacingDesk.Plugin.DS.StartPosition': start,
    'RacingDesk.Plugin.DS.PositionDelta': start > 0 && !noPlaces ? start - me : 0,
    'DataCorePlugin.GameData.Position': noPlaces ? 0 : me,
    'DataCorePlugin.GameData.CurrentLap': lap,
    'DataCorePlugin.GameData.LastLapTime': board[me - 1][4],
    'DataCorePlugin.GameData.BestLapTime': 92.347,
    'DataCorePlugin.GameData.CurrentLapTime': curLapTime,
    'DataCorePlugin.GameData.TotalLaps': totalLaps,
    'RacingDesk.Plugin.Leaderboard': board,
    'RacingDesk.Plugin.DS.LapDelta': lapDelta,
    'RacingDesk.Plugin.DS.CurrentSector': 2,
    'RacingDesk.Plugin.DS.IncidentCount': incidents,
    'RacingDesk.Plugin.DS.IncidentLimitPenalty': 17,
    'RacingDesk.Plugin.DS.IncidentLimitDQ': 25,
    'RacingDesk.Plugin.TrackMap.Ready': 1,
    'RacingDesk.Plugin.TrackMap.TrackName': track,
    'RacingDesk.Plugin.TrackMap.TrackDisplayName': 'Synthetic Circuit',
    'RacingDesk.Plugin.TrackMap.SvgPath': SVG_PATH,
    'RacingDesk.Plugin.TrackMap.PlayerX': +p.x.toFixed(2),
    'RacingDesk.Plugin.TrackMap.PlayerY': +p.y.toFixed(2),
    'RacingDesk.Plugin.TrackMap.PlayerHeading': +p.heading.toFixed(1),
    'RacingDesk.Plugin.TrackMap.Opponents': others,
    'IRacingExtraProperties.iRacing_Opponent_Ahead_Name': short(order[me - 2]),
    'IRacingExtraProperties.iRacing_Opponent_Behind_Name': short(order[me]),
    // Where he is round the lap, the sectors (three, at a third and two thirds) and what he has done in them.
    'RacingDesk.Plugin.DS.TrackPct': +((((playerPct % 1) + 1) % 1).toFixed(5)),
    'RacingDesk.Plugin.DS.SectorCount': 3,
    'RacingDesk.Plugin.DS.SectorS2StartPct': 0.333,
    'RacingDesk.Plugin.DS.SectorS3StartPct': 0.667,
    'RacingDesk.Plugin.DS.SectorSplitS1': 30.512, 'RacingDesk.Plugin.DS.SectorDeltaS1': -0.104, 'RacingDesk.Plugin.DS.SectorStateS1': 1,
    'RacingDesk.Plugin.DS.SectorSplitS2': 31.270, 'RacingDesk.Plugin.DS.SectorDeltaS2': 0.186, 'RacingDesk.Plugin.DS.SectorStateS2': 3,
    'RacingDesk.Plugin.DS.SectorSplitS3': 0, 'RacingDesk.Plugin.DS.SectorDeltaS3': 0, 'RacingDesk.Plugin.DS.SectorStateS3': 0,
    'RacingDesk.Plugin.DS.SectorBests': '30.512,31.084,30.371',
    'RacingDesk.Plugin.DS.CurrentSector': ((((playerPct % 1) + 1) % 1) < 0.333 ? 1 : (((playerPct % 1) + 1) % 1) < 0.667 ? 2 : 3),
    'RacingDesk.Plugin.DS.IsLapRace': mode === 4 ? 1 : 0,
    'DataCorePlugin.GameData.RemainingLaps': Math.max(0, totalLaps - lap),
    'RacingDesk.Plugin.DS.FuelLapsRemaining': fuelLaps,
    'RacingDesk.Plugin.DS.TrackTemp': 31.5,
    'RacingDesk.Plugin.DS.AirTemp': 22.4,
    'RacingDesk.Plugin.DS.EstimatedIRatingDelta': 18,
    'RacingDesk.Plugin.DS.LatG': 1.24,
    'RacingDesk.Plugin.DS.LongG': -0.42,
    'RacingDesk.Plugin.DS.YawRate': 0.31,
    'RacingDesk.Plugin.DS.SteerTorque': 7.8,
    'RacingDesk.Plugin.DS.ThrottleNorm': 0.82,
    'RacingDesk.Plugin.DS.BrakeNorm': 0,
    'RacingDesk.Plugin.Grid.TotalCars': order.length,
    currentFlagState: flag,
  };
  if (controls) {
    payload['RacingDesk.Plugin.CarControls'] = controls;
    payload['DataCorePlugin.GameData.CarModel'] = controls.name;
  }
  return payload;
}
