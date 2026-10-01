/**
 * The telemetry sidecar's writer (modules/js/telemetry-sidecar.js), pure: the header lazily from the first frame, the
 * frames with the sim's own clock on each, the markers, a write every 30 frames, the summary, and the three fields
 * the old page-side writer got wrong.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { createSidecar, sidecarPathFor, trackAndCar, KEYS, FLUSH_EVERY } = require('../../modules/js/telemetry-sidecar.js');

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
  expect(result).toMatchObject({ path: 'x.telemetry.jsonl', frames: 35, markers: 0, chapters: 0 });
  expect(result.summary).toMatchObject({ _type: 'summary', frames: 35, reason: 'stopped' });
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

test('the summary says how the offset was found and lists the chapters sent, each with its t; the header says what the file is beside', () => {
  const { sidecar, lines, tick } = harness();
  sidecar.start({ path: 'r.telemetry.jsonl', obsOutputPath: 'r.mp4' });
  tick(1000);
  sidecar.frame(RACE);
  tick(500);
  expect(sidecar.chapter({ name: 'Lap 9' })).toBe(true);
  tick(10000);
  sidecar.chapter({ name: 'Pit in' });
  expect(sidecar.chapter({ name: '' })).toBe(false);
  expect(sidecar.state().chapters).toEqual([{ name: 'Lap 9', frame: 1, t: 1500 }, { name: 'Pit in', frame: 1, t: 11500 }]);
  sidecar.stop({ reason: 'stopped', videoOffsetMs: 2237.4, alignment: { method: 'chapters', pairs: 2, spreadMs: 17 } });
  const [header, , summary] = lines();
  expect(header.kind).toBe('recording');
  expect(summary).toMatchObject({ _type: 'summary', videoOffsetMs: 2237, alignment: { method: 'chapters', pairs: 2, spreadMs: 17 }, chapters: [{ name: 'Lap 9', frame: 1, t: 1500 }, { name: 'Pit in', frame: 1, t: 11500 }] });
  // With no offset found the summary says so, and carries the header's 0.
  const plain = harness();
  plain.sidecar.start({ path: 'p.telemetry.jsonl', kind: 'replay' });
  plain.sidecar.frame(RACE);
  plain.sidecar.stop();
  expect(plain.lines()[0].kind).toBe('replay');
  expect(plain.lines().at(-1)).toMatchObject({ videoOffsetMs: 0, alignment: { method: 'none' }, chapters: [] });
});

test('a marker found in a frame is handed to onMarker as it is found; relocate moves what follows to the new path after flushing', () => {
  const writes = [];
  const found = [];
  let clock = 1_700_000_000_000;
  const sidecar = createSidecar({ write: (path, text) => writes.push({ path, text }), now: () => clock, onMarker: (m) => found.push(m) });
  sidecar.start({ path: 'a.telemetry.jsonl' });
  sidecar.frame(RACE);
  clock += 1000;
  sidecar.frame({ ...RACE, 'DataCorePlugin.GameData.CurrentLap': 9 });
  expect(found).toEqual([{ type: 'new_lap', frame: 1, t: 1000, lap: 9 }]);
  expect(writes).toHaveLength(1);   // the header alone; the two frames are buffered
  expect(sidecar.relocate('b/a.telemetry.jsonl')).toBe(true);
  expect(writes).toHaveLength(2);   // the frames were flushed to the old path first
  expect(writes[1].path).toBe('a.telemetry.jsonl');
  sidecar.stop();
  expect(writes[2].path).toBe('b/a.telemetry.jsonl');
  expect(JSON.parse(writes[2].text.trim())._type).toBe('summary');
  expect(sidecar.relocate('c')).toBe(false);
});

test('the track is read from SimHub\'s key, else the host\'s, else the map\'s; the car from the sim\'s model', () => {
  expect(trackAndCar({ 'DataCorePlugin.GameData.TrackName': 'zandvoort gp', 'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R' })).toEqual({ track: 'zandvoort gp', car: 'Porsche 911 GT3 R' });
  expect(trackAndCar({ 'RacingDesk.Plugin.Session.TrackName': 'Zandvoort', 'DataCorePlugin.GameData.CarModel': 'x' })).toEqual({ track: 'Zandvoort', car: 'x' });
  expect(trackAndCar({ 'RacingDesk.Plugin.TrackMap.TrackName': 'tsukuba 2000full' })).toEqual({ track: 'tsukuba 2000full', car: null });
  expect(trackAndCar({ 'RacingDesk.Plugin.DemoMode': 1, 'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3', 'RacingDesk.Plugin.Demo.TrackName': 'Spa' })).toEqual({ track: 'Spa', car: 'BMW M4 GT3' });
  expect(trackAndCar(null)).toEqual({ track: null, car: null });
  expect(trackAndCar({ 'DataCorePlugin.GameData.TrackName': '  ' })).toEqual({ track: null, car: null });
  // The header reads the same.
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'h.telemetry.jsonl' });
  const hostOnly = { ...RACE };
  delete hostOnly['DataCorePlugin.GameData.TrackName'];
  sidecar.frame({ ...hostOnly, 'RacingDesk.Plugin.Session.TrackName': 'Zandvoort' });
  sidecar.stop();
  expect(lines()[0].track).toBe('Zandvoort');
});

test('a live payload that does not name its car yet gets no car, not the demo\'s (the host sends the demo\'s keys all the time); the display name of the track is preferred', () => {
  const live = {
    'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.DemoMode': 0,
    'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3', 'RacingDesk.Plugin.Demo.TrackName': 'Spa-Francorchamps',
    'DataCorePlugin.GameData.TrackName': 'spa 2024 up', 'RacingDesk.Plugin.TrackMap.TrackDisplayName': 'Circuit de Spa-Francorchamps',
  };
  expect(trackAndCar(live)).toEqual({ track: 'Circuit de Spa-Francorchamps', car: null });
  expect(trackAndCar({ ...live, 'RacingDesk.Plugin.TrackMap.TrackDisplayName': '' })).toEqual({ track: 'spa 2024 up', car: null });
  expect(trackAndCar({ ...live, 'DataCorePlugin.GameData.TrackName': '', 'RacingDesk.Plugin.TrackMap.TrackDisplayName': '' })).toEqual({ track: null, car: null });
  expect(trackAndCar({ ...live, 'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R' }).car).toBe('Porsche 911 GT3 R');
  // The demo is the demo's.
  expect(trackAndCar({ ...live, 'RacingDesk.Plugin.DemoMode': 1 })).toEqual({ track: 'Spa-Francorchamps', car: 'BMW M4 GT3' });
  // And the header says the same: no car, where the sim has not said it.
  const { sidecar, lines } = harness();
  sidecar.start({ path: 'h.telemetry.jsonl' });
  sidecar.frame(live);
  sidecar.stop();
  expect(lines()[0]).toMatchObject({ car: null, track: 'Circuit de Spa-Francorchamps', isDemo: false });
});

test('the ring keeps only what a frame is made of: the trimmed payload writes the same sidecar, live or demo, from a fraction of the keys', () => {
  const { sidecarKeys, trimPayload } = require('../../modules/js/telemetry-sidecar.js');
  expect(sidecarKeys()).toContain('DataCorePlugin.GameRunning');   // what says a sim session is live
  expect(sidecarKeys()).toContain(KEYS.sessionTime);
  const big = { ...RACE, Leaderboard: 'x'.repeat(5000), 'RacingDesk.Plugin.Anything.Else': 1 };
  for (const payload of [big, { ...MOCK_DEMO, 'RacingDesk.Plugin.Other': 2 }]) {
    const text = (p) => {
      const h = harness();
      h.sidecar.start({ path: 'x.telemetry.jsonl' });
      h.tick(33);
      h.sidecar.frame(p);
      h.sidecar.stop({ stoppedAt: h.clock() });
      return JSON.stringify(h.lines());
    };
    const trimmed = trimPayload(payload);
    expect(text(trimmed)).toBe(text(payload));
    expect(Object.keys(trimmed).length).toBeLessThan(Object.keys(payload).length);
    expect('Leaderboard' in trimmed).toBe(false);
  }
  expect(trimPayload(null)).toBeNull();
});

test('chapters are kept as OBS took them, with the frame they were found in; the summary carries the pauses and is handed back', () => {
  const { sidecar, lines, tick } = harness();
  sidecar.start({ path: 'x.telemetry.jsonl' });
  sidecar.frame(RACE);
  tick(1000);
  sidecar.frame(RACE);
  sidecar.frame(RACE);
  expect(sidecar.chapter({ name: 'Lap 9', at: 1_700_000_000_000 + 1000, frame: 1 })).toBe(true);
  expect(sidecar.chapter({ name: 'Lap 10', at: 1_700_000_000_000 + 1500 })).toBe(true);
  tick(1000);
  const result = sidecar.stop({ reason: 'stopped', pauses: [{ from: 1200, to: 1400 }, { from: 1800, to: null }] });
  const summary = lines().at(-1);
  expect(summary.chapters).toEqual([{ name: 'Lap 9', frame: 1, t: 1000 }, { name: 'Lap 10', frame: 3, t: 1500 }]);
  expect(summary.pauses).toEqual([{ from: 1200, to: 1400 }, { from: 1800, to: 2000 }]);   // one still open is closed at the stop
  expect(result.summary).toEqual(summary);
  // No pauses: no key.
  const again = harness();
  again.sidecar.start({ path: 'y.telemetry.jsonl' });
  again.sidecar.frame(RACE);
  expect('pauses' in again.sidecar.stop({ pauses: [] }).summary).toBe(false);
});

test('the two ends of a sidecar file: its header, its last summary, and the last frame written; a line cut short by a crash is skipped', () => {
  const { parseSidecarEnds } = require('../../modules/js/telemetry-sidecar.js');
  const h = harness();
  h.sidecar.start({ path: 'x.telemetry.jsonl', startedAt: 1_700_000_000_000 });
  for (let i = 0; i < 5; i++) { h.tick(33); h.sidecar.frame(RACE); }
  h.sidecar.chapter({ name: 'Lap 9', at: 1_700_000_000_100 });
  h.sidecar.stop({ reason: 'OBS went away' });
  const text = h.writes.map((w) => w.text).join('');
  const whole = parseSidecarEnds({ head: text, tail: text, whole: true });
  expect(whole.header).toMatchObject({ _type: 'header', startedAt: new Date(1_700_000_000_000).toISOString() });
  expect(whole.summary).toMatchObject({ _type: 'summary', reason: 'OBS went away', frames: 5, chapters: [{ name: 'Lap 9' }] });
  expect(whole.lastFrame).toBe(4);
  // Only the tail of a big file: its first line is cut, and is skipped.
  const lines = text.split('\n').filter(Boolean);
  const tail = lines[3].slice(10) + '\n' + lines.slice(4).join('\n') + '\n';
  expect(parseSidecarEnds({ head: text, tail })).toMatchObject({ summary: { frames: 5 }, lastFrame: 4 });
  // A crash: no summary, the last line half written.
  const crashed = lines.slice(0, 4).join('\n') + '\n' + lines[4].slice(0, 40);
  expect(parseSidecarEnds({ head: crashed, tail: crashed, whole: true })).toMatchObject({ summary: null, lastFrame: 2 });
  // Nothing readable: nothing found, nothing thrown.
  expect(parseSidecarEnds({ head: '', tail: '' })).toEqual({ header: null, summary: null, lastFrame: null });
  expect(parseSidecarEnds()).toEqual({ header: null, summary: null, lastFrame: null });
});
