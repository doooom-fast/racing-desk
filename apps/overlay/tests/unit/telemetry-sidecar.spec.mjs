/**
 * The telemetry sidecar's writer (modules/js/telemetry-sidecar.js), pure: the header lazily from the first frame, the
 * frames with the sim's own clock on each, the markers, a write every 30 frames, the summary, and the three fields
 * the old page-side writer got wrong.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { createSidecar, sidecarPathFor, KEYS, FLUSH_EVERY } = require('../../modules/js/telemetry-sidecar.js');

const RACE = {
  ...MOCK_TELEMETRY,
  'DataCorePlugin.GameData.TrackName': 'zandvoort gp',
  'DataCorePlugin.GameRawData.Telemetry.SessionNum': 2,
  'DataCorePlugin.GameRawData.Telemetry.SessionTime': 1234.5678,
  'DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle': -0.21,
  'RacingDesk.Plugin.DS.IncidentCount': 2,
  'RacingDesk.Plugin.DS.IsInPitLane': 0,
  'RacingDesk.Plugin.DS.CurrentSector': 2,
  currentFlagState: 'green',
};

function harness(startAt = 1_700_000_000_000) {
  const writes = [];
  let clock = startAt;
  const sidecar = createSidecar({ write: (path, text) => writes.push({ path, text }), now: () => clock });
  const lines = () => writes.flatMap((w) => w.text.split('\n').filter(Boolean)).map((l) => JSON.parse(l));
  return { sidecar, writes, lines, tick: (ms) => { clock += ms; }, clock: () => clock };
}

test('the header comes with the first frame and says who made it and for which file; frames carry the sim\'s clock', () => {
  const { sidecar, writes, lines, tick } = harness();
  sidecar.start({ path: 'D:\\R\\race.telemetry.jsonl', obsOutputPath: 'D:\\R\\race.mp4' });
  expect(writes).toEqual([]);   // nothing until a frame: the header reads the car and track from the first
  tick(33);
  sidecar.frame(RACE);
  sidecar.stop();
  const [header, frame, summary] = lines();
  expect(header).toMatchObject({
    _type: 'header', schemaVersion: 1, car: 'Porsche 911 GT3 R', track: 'zandvoort gp', gameId: 'iracing', isDemo: false,
    producer: 'obs', obsOutputPath: 'D:\\R\\race.mp4', videoOffsetMs: 0,
  });
  expect(header.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
  expect(header.videoStartUtc).toBe(header.startedAt);
  expect(frame).toMatchObject({ t: 0.033, frame: 0, sn: 2, st: 1234.568, pos: 5, lap: 8, sector: 2, incidents: 2, flag: 'green', pit: false, speed: 127, steer: -0.21, sessionState: 4 });
  expect(frame.gear).toBe('4');
  expect('closestCar' in frame).toBe(false);
  expect(summary).toMatchObject({ _type: 'summary', frames: 1, durationMs: 33, markers: [], obsOutputPath: 'D:\\R\\race.mp4' });
  expect(writes.every((w) => w.path === 'D:\\R\\race.telemetry.jsonl')).toBe(true);
});

test('the three fields the page-side writer got wrong: the flag is the payload\'s word, the gear is the string the HUD shows, and no field is made up', () => {
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl' });
  sidecar.frame({ ...RACE, currentFlagState: 'yellow', 'DataCorePlugin.GameData.Gear': 'N' });
  sidecar.frame({ ...RACE, currentFlagState: '', 'DataCorePlugin.GameData.Gear': 'R' });
  sidecar.frame({ ...RACE, 'DataCorePlugin.GameRawData.Telemetry.SessionNum': undefined, 'DataCorePlugin.GameRawData.Telemetry.SessionTime': 'nan' });
  sidecar.stop();
  const frames = lines().filter((l) => !l._type);
  expect(frames.map((f) => f.flag)).toEqual(['yellow', 'none', 'green']);
  expect(frames.map((f) => f.gear)).toEqual(['N', 'R', '4']);
  // A sim that does not say its clock: the fields are absent, not 0.
  expect('sn' in frames[2]).toBe(false);
  expect('st' in frames[2]).toBe(false);
  expect(KEYS.flag).toBe('currentFlagState');
});

test('markers: an incident, a place gained and lost, a new lap, pit entry and exit, and one of the caller\'s', () => {
  const { sidecar, lines, tick } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl' });
  let payload = { ...RACE };
  const at = (changes) => { tick(1000); payload = { ...payload, ...changes }; sidecar.frame(payload); };
  at({});
  at({ 'RacingDesk.Plugin.DS.IncidentCount': 4 });
  at({ 'DataCorePlugin.GameData.Position': 4 });
  at({ 'DataCorePlugin.GameData.Position': 6 });
  at({ 'DataCorePlugin.GameData.CurrentLap': 9 });
  at({ 'RacingDesk.Plugin.DS.IsInPitLane': 1 });
  at({ 'RacingDesk.Plugin.DS.IsInPitLane': 0 });
  tick(500);
  sidecar.marker({ type: 'file_changed', path: 'D:\\R\\race (1).mp4' });
  sidecar.stop();
  const summary = lines().at(-1);
  expect(summary.markers).toEqual([
    { type: 'incident', frame: 1, t: 2000, from: 2, to: 4 },
    { type: 'position_change', frame: 2, t: 3000, from: 5, to: 4, direction: 'gained' },
    { type: 'position_change', frame: 3, t: 4000, from: 4, to: 6, direction: 'lost' },
    { type: 'new_lap', frame: 4, t: 5000, lap: 9 },
    { type: 'pit_entry', frame: 5, t: 6000 },
    { type: 'pit_exit', frame: 6, t: 7000 },
    { type: 'file_changed', path: 'D:\\R\\race (1).mp4', frame: 7, t: 7500 },
  ]);
  expect(summary.frames).toBe(7);
  expect(summary.durationMs).toBe(7500);
});

test('the header is written at once; frames every 30, and the rest on stop', () => {
  const { sidecar, writes } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl' });
  expect(writes).toEqual([]);
  for (let i = 0; i < FLUSH_EVERY - 1; i++) sidecar.frame(RACE);
  expect(writes).toHaveLength(1);                                       // the header alone, from the first frame
  expect(JSON.parse(writes[0].text)._type).toBe('header');
  sidecar.frame(RACE);
  expect(writes).toHaveLength(2);
  expect(writes[1].text.split('\n').filter(Boolean)).toHaveLength(FLUSH_EVERY);   // 30 frames
  for (let i = 0; i < 5; i++) sidecar.frame(RACE);
  const result = sidecar.stop({ reason: 'stopped' });
  expect(writes).toHaveLength(3);
  expect(writes[2].text.split('\n').filter(Boolean)).toHaveLength(6);   // five frames and the summary
  expect(result).toEqual({ path: 'x.telemetry.jsonl', frames: 35, markers: 0 });
  expect(sidecar.isActive()).toBe(false);
  // Stopped, it takes no frame and stops no more.
  expect(sidecar.frame(RACE)).toBe(false);
  expect(sidecar.stop()).toBeNull();
});

test('a demo payload is marked as one and read from the demo keys', () => {
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl' });
  sidecar.frame({ ...MOCK_DEMO, 'RacingDesk.Plugin.Demo.CurrentLap': 12, 'RacingDesk.Plugin.Demo.Grid.SessionState': 4 });
  sidecar.stop();
  const [header, frame] = lines();
  expect(header.isDemo).toBe(true);
  expect(header.car).toBe('BMW M4 GT3');
  expect(frame).toMatchObject({ pos: 3, lap: 12, speed: 98, gear: '3', sessionState: 4, bb: 54, tc: 6, abs: 2 });
});

test('stopped before any frame, the file still has a header and a summary; the sidecar\'s path is the video\'s with its extension swapped', () => {
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl', obsOutputPath: 'x.mp4' });
  sidecar.stop({ reason: 'OBS went away' });
  const [header, summary] = lines();
  expect(header).toMatchObject({ _type: 'header', car: null, track: null, gameId: null, isDemo: false, obsOutputPath: 'x.mp4' });
  expect(summary).toMatchObject({ _type: 'summary', frames: 0, reason: 'OBS went away' });
  expect(sidecarPathFor('D:\\Racing Desk\\Recordings\\2026-09-30 21-00-00.mp4')).toBe('D:\\Racing Desk\\Recordings\\2026-09-30 21-00-00.telemetry.jsonl');
  expect(sidecarPathFor('clip.mkv')).toBe('clip.telemetry.jsonl');
  expect(sidecarPathFor('noext')).toBe('noext.telemetry.jsonl');
});

test('started again while active, the first is closed with a summary before the second begins', () => {
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'a.telemetry.jsonl' });
  sidecar.frame(RACE);
  sidecar.start({ path: 'b.telemetry.jsonl' });
  sidecar.frame(RACE);
  sidecar.stop();
  const all = lines();
  expect(all.filter((l) => l._type === 'summary')).toHaveLength(2);
  expect(all[2]).toMatchObject({ _type: 'summary', reason: 'started again', frames: 1 });
});

test('resumed: a file that has its header is gone on in, with a resumed line and no second header; t goes on from the video\'s start', () => {
  const { sidecar, writes, lines, tick } = harness();
  // The first run of the recording: header, a frame, a summary.
  sidecar.start({ path: 'r.telemetry.jsonl', obsOutputPath: 'r.mp4' });
  tick(100);
  sidecar.frame(RACE);
  sidecar.stop({ reason: 'OBS went away' });
  const first = lines().length;
  expect(first).toBe(3);
  // Racing Desk finds OBS still recording the same file, 20 s in: the video began 20 s ago.
  tick(5000);
  sidecar.start({ path: 'r.telemetry.jsonl', startedAt: 1_700_000_000_000, obsOutputPath: 'r.mp4', resume: true });
  tick(100);
  sidecar.frame(RACE);
  sidecar.stop({ reason: 'stopped' });
  const all = lines();
  expect(all.filter((l) => l._type === 'header')).toHaveLength(1);
  const [, , , resumed, frame, summary] = all;
  expect(resumed).toMatchObject({ _type: 'resumed', schemaVersion: 1 });
  expect(typeof resumed.resumedAt).toBe('string');
  expect(resumed.t).toBeCloseTo(5.1, 1);          // seconds into the video when it was found again
  expect(frame).toMatchObject({ frame: 0 });
  expect(frame.t).toBeCloseTo(5.2, 1);
  expect(summary).toMatchObject({ _type: 'summary', frames: 1, reason: 'stopped', resumed: true });
  expect(writes.every((w) => w.path === 'r.telemetry.jsonl')).toBe(true);
});
