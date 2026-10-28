// ═══════════════════════════════════════════════════════════════
// RENDER PLAN TESTS — each cut of the EDL as a stretch of a video
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { planSegments } from '../src/render/ffmpeg-assembly.js';

const exists = () => true;
const lined = { videoOffsetMs: -3500, alignment: { method: 'chapters' } };
const session = (summary, sources = {}) => ({
  sidecarSummary: summary,
  sources: { cockpit: { file: 'race.mp4', path: 'D:\\R\\race.mp4', duration: 1200 }, tvView: null, clips: [], ...sources },
});

test('each cut is cut from the video where the video shows it', () => {
  const plan = planSegments(session(lined), [
    { start: '1:37', end: '1:48', source: 'cockpit' },
    { start: '2:00', end: '2:10', source: 'mixed' },
  ], { exists });
  assert.deepStrictEqual(plan.segments.map(({ source, path, start, end }) => ({ source, path, start, end })), [
    { source: 'cockpit', path: 'D:\\R\\race.mp4', start: 93.5, end: 104.5 },
    { source: 'cockpit', path: 'D:\\R\\race.mp4', start: 116.5, end: 126.5 },
  ]);
  assert.deepStrictEqual(plan.skipped, []);
});

test('a pause in the recording is taken out of every cut after it', () => {
  const plan = planSegments(session({ ...lined, pauses: [{ from: 30000, to: 50000 }] }), [
    { start: '0:20', end: '0:25', source: 'cockpit' },
    { start: '1:00', end: '1:05', source: 'cockpit' },
    { start: '0:35', end: '0:45', source: 'cockpit' },
  ], { exists });
  assert.deepStrictEqual(plan.segments.map(({ start, end }) => [start, end]), [[16.5, 21.5], [36.5, 41.5]]);
  assert.deepStrictEqual(plan.skipped.map((s) => s.cut.start), ['0:35']);
  assert.match(plan.skipped[0].why, /not in the video/);
});

test('a cut before the file began, past its end, or empty is skipped and said', () => {
  const plan = planSegments(session(lined), [
    { start: '0:00', end: '0:03', source: 'cockpit' },
    { start: '20:10', end: '20:20', source: 'cockpit' },
    { start: '1:00', end: '1:00', source: 'cockpit' },
    { start: '19:58', end: '20:20', source: 'cockpit' },
  ], { exists });
  assert.deepStrictEqual(plan.skipped.map((s) => s.why), ['that stretch is not in the video', 'that stretch is not in the video', 'it is empty']);
  assert.deepStrictEqual(plan.segments.map(({ start, end }) => [start, end]), [[1194.5, 1200]]);
});

test('a TV take is on a clock of its own: its cuts are the cockpit\'s, and that is said', () => {
  const plan = planSegments(session(lined, { tvView: { file: 'race tv.mp4', path: 'D:\\R\\race tv.mp4', duration: 90 } }), [
    { start: '1:37', end: '1:48', source: 'tv' },
  ], { exists });
  assert.strictEqual(plan.segments[0].source, 'cockpit');
  assert.strictEqual(plan.segments[0].start, 93.5);
  assert.match(plan.notes.join(' '), /not on the recording's clock/);
});

test('a second file of an OBS recording (a split) is not the cockpit\'s clock either', () => {
  const plan = planSegments(session(lined, { tvView: { file: 'race (2).mp4', path: 'D:\\R\\race (2).mp4', duration: 600 } }), [
    { start: '1:37', end: '1:48', source: 'tv' },
  ], { exists });
  assert.strictEqual(plan.segments[0].source, 'cockpit');
});

test('a recording from before OBS keeps its TV view, cut at the telemetry\'s time as it always was', () => {
  const plan = planSegments(session(null, { tvView: { file: 'broadcast.mp4', path: 'D:\\R\\broadcast.mp4', duration: 1200 } }), [
    { start: '1:37', end: '1:48', source: 'tv' },
    { start: '2:00', end: '2:10', source: 'cockpit' },
  ], { exists });
  assert.deepStrictEqual(plan.segments.map(({ source, start, end }) => [source, start, end]), [['tv', 97, 108], ['cockpit', 120, 130]]);
  assert.deepStrictEqual(plan.notes, []);
});

test('no cockpit video is an error, and a TV view that is not there is said once', () => {
  assert.throws(() => planSegments(session(lined), [{ start: '0:10', end: '0:20', source: 'cockpit' }], { exists: () => false }), /Cockpit video not found/);
  const plan = planSegments(session(lined, { tvView: { file: 'b.mp4', path: 'D:\\R\\b.mp4' } }), [
    { start: '0:10', end: '0:20', source: 'tv' },
  ], { exists: (p) => p === 'D:\\R\\race.mp4' });
  assert.match(plan.notes.join(' '), /No TV-view video found/);
});
