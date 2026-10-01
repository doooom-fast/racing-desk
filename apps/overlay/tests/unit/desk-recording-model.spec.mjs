/**
 * The Recording card's model and the masthead pill's (modules/desk/recording-model.js): the sentences for every state
 * the app sends, what Set up OBS says it will change, and the read-only card without the app.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const model = require('../../modules/desk/recording-model.js');

const READY = {
  obs: 'open', obsVersion: '32.1.2', recording: false, starting: false, stopping: false, paused: false, owned: false, outputPath: null,
  startedAt: null, elapsedMs: 0, bytes: 0, bytesPerSecond: 12.5e6, free: { bytes: 400e9, hoursLeft: 400e9 / 12.5e6 / 3600, drive: 'D:' },
  lowDisk: null, last: null, busy: null, sidecar: null,
  auto: false, autoRecord: true, chapters: 0, filed: null, lastFiled: null, replay: { on: false, running: false, unavailable: null, lastSaved: null },
  folder: 'D:\\Racing Desk\\Recordings',
  setup: { wsState: 'ok', wsEnabled: true, wsPort: 4455, profile: 'Untitled', hybrid: true, replayBuffer: true, folderSet: true, folderExists: true, obsFound: true, needed: false },
  needsPassword: false, passwordTyped: false, obsStartOnRecord: true, obsStartWithApp: false, obsPath: null,
  recordingAutoRecord: true, recordingInstantReplay: false, recordingChapters: true,
};

test('time and size read as a person says them', () => {
  expect(model.formatElapsed(0)).toBe('0:00');
  expect(model.formatElapsed(754_000)).toBe('12:34');
  expect(model.formatElapsed(3_723_000)).toBe('1:02:03');
  expect(model.formatBytes(3.14e9)).toBe('3.1 GB');
  expect(model.formatBytes(512e6)).toBe('512 MB');
  expect(model.formatHours(8.9)).toBe('9 hours');
  expect(model.formatHours(1.4)).toBe('about an hour');
  expect(model.formatHours(0.5)).toBe('30 minutes');
  expect(model.formatHours(60)).toBe('3 days');
});

test('the state line says what OBS and the recording are doing', () => {
  expect(model.stateLine(READY)).toBe('OBS is open, not recording');
  expect(model.stateLine({ ...READY, recording: true, elapsedMs: 754_000 })).toBe('Recording 12:34');
  expect(model.stateLine({ ...READY, starting: true })).toBe('Starting the recording…');
  expect(model.stateLine({ ...READY, busy: 'starting-obs', obs: 'closed' })).toBe('Starting OBS…');
  expect(model.stateLine({ ...READY, obs: 'closed' })).toBe('OBS is not open');
  expect(model.stateLine({ ...READY, obs: 'connecting' })).toBe('Looking for OBS…');
  expect(model.stateLine({ ...READY, obs: 'authFailed' })).toBe('OBS refused the password');
  expect(model.stateLine({ ...READY, obs: 'passwordMissing' })).toBe('OBS wants a password');
});

test('the pill: Record while OBS is open or closed (the keeper decides whether OBS may be started), Stop while recording, nothing pressable while busy', () => {
  expect(model.pill(READY)).toEqual({ text: 'OBS is open, not recording', state: 'ready', detail: 'OBS is open, not recording', button: { label: 'Record', enabled: true, command: 'toggle' } });
  const rec = model.pill({ ...READY, recording: true, owned: true, elapsedMs: 61_000, outputPath: 'D:/Racing Desk/Recordings/a.mp4' });
  expect(rec).toMatchObject({ text: 'Recording 1:01', state: 'recording', detail: 'D:/Racing Desk/Recordings/a.mp4', button: { label: 'Stop', enabled: true } });
  expect(model.pill({ ...READY, obs: 'closed' })).toMatchObject({ text: 'OBS is not open', state: 'off', button: { label: 'Record', enabled: true } });
  expect(model.pill({ ...READY, busy: 'starting-obs', obs: 'closed' })).toMatchObject({ state: 'busy', button: { label: 'Record', enabled: false } });
  expect(model.pill({ ...READY, obs: 'authFailed' })).toMatchObject({ state: 'warn' });
  // Without the app: there, and not pressable.
  expect(model.pill(null, { inApp: false })).toEqual({ text: 'Recording', state: 'off', detail: 'This is switched from the Racing Desk app.', button: { label: 'Record', enabled: false, command: 'toggle' } });
});

test('Set up OBS says in one sentence what it will change, and the network sentence once, only with the WebSocket', () => {
  expect(model.setupSentence(READY)).toBeNull();
  const fresh = { ...READY, setup: { ...READY.setup, wsEnabled: false, hybrid: false, replayBuffer: false, folderSet: false, needed: true } };
  expect(model.setupSentence(fresh)).toBe(
    "Set up OBS will switch on OBS's WebSocket, set your profile to Hybrid MP4, turn its 20 s replay buffer on and point its recordings at D:\\Racing Desk\\Recordings. "
    + 'Your own Ctrl+Space recordings become Hybrid MP4 and go to D:\\Racing Desk\\Recordings too. OBS then answers on port 4455 to anything on your network that knows the password.',
  );
  const onlyFolder = { ...READY, setup: { ...READY.setup, folderSet: false, needed: true } };
  // Only what is really changing is said of his own Ctrl+Space recordings: here they move, and are Hybrid MP4 already.
  expect(model.setupSentence(onlyFolder)).toBe('Set up OBS will point its recordings at D:\\Racing Desk\\Recordings. Your own Ctrl+Space recordings go to D:\\Racing Desk\\Recordings too.');
  const onlyFormat = { ...READY, setup: { ...READY.setup, hybrid: false, needed: true } };
  expect(model.setupSentence(onlyFormat)).toBe('Set up OBS will set your profile to Hybrid MP4. Your own Ctrl+Space recordings become Hybrid MP4 too.');
  // The replay buffer changes nothing of theirs: nothing is said of them.
  const onlyReplay = { ...READY, setup: { ...READY.setup, replayBuffer: false, needed: true } };
  expect(model.setupSentence(onlyReplay)).toBe('Set up OBS will turn its 20 s replay buffer on.');
  // A buffer that is on and the wrong length is said too, in the same words as the profile change says it afterwards.
  const wrongLength = { ...READY, setup: { ...READY.setup, replaySeconds: false, needed: true } };
  expect(model.setupSentence(wrongLength)).toBe('Set up OBS will set its replay buffer to 20 s.');
  expect(model.setupSentence({ ...READY, setup: { ...READY.setup, replayBuffer: false, replaySeconds: false, needed: true } })).toBe('Set up OBS will turn its 20 s replay buffer on.');
  const onlyWs = { ...READY, setup: { ...READY.setup, wsEnabled: false, needed: true } };
  expect(model.setupSentence(onlyWs)).toBe("Set up OBS will switch on OBS's WebSocket. OBS then answers on port 4455 to anything on your network that knows the password.");
  expect(model.setupSentence(onlyWs).split('port 4455').length).toBe(2);
});

test('the card: buttons and sentences for the states, the switches, the folder', () => {
  const ready = model.card(READY);
  expect(ready.line).toBe('OBS is open, not recording');
  expect(ready.record).toEqual({ label: 'Record', enabled: true });
  expect(ready.openObs.show).toBe(false);
  expect(ready.setup.show).toBe(false);
  expect(ready.password.show).toBe(false);
  expect(ready.details).toEqual(['About 9 hours of recording left on D: at 100 Mbps.']);   // 400 GB at 12.5 MB/s
  expect(ready.folder).toBe('D:\\Racing Desk\\Recordings');
  expect(ready.switches.map((s) => [s.key, s.value, s.enabled])).toEqual([
    ['recordingAutoRecord', true, true], ['recordingInstantReplay', false, true], ['recordingChapters', true, true], ['obsStartOnRecord', true, true], ['obsStartWithApp', false, true],
  ]);
  expect(ready.saveReplay).toEqual({ show: false, enabled: false });

  const recording = model.card({ ...READY, recording: true, owned: true, elapsedMs: 754_000, bytes: 3.1e9, outputPath: 'D:/Racing Desk/Recordings/a.mp4', sidecar: { path: 'x', frames: 1200 } });
  expect(recording.line).toBe('Recording 12:34');
  expect(recording.record).toEqual({ label: 'Stop', enabled: true });
  expect(recording.details[0]).toBe('3.1 GB · D:/Racing Desk/Recordings/a.mp4');
  expect(recording.details[1]).toBe('Telemetry is being written beside it (1200 frames).');
  // With chapters, a folder to go to, and started by itself.
  const chaptered = model.card({ ...READY, recording: true, owned: true, auto: true, elapsedMs: 754_000, bytes: 3.1e9, chapters: 7, outputPath: 'D:/Racing Desk/Recordings/a.mp4', sidecar: { path: 'x', frames: 1200 }, filed: { folder: 'D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup' } });
  expect(chaptered.details[0]).toBe('3.1 GB · 7 chapters · D:/Racing Desk/Recordings/a.mp4 · started by itself');
  expect(chaptered.details[1]).toBe('Telemetry is being written beside it (1200 frames). It goes to D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup when it stops.');
  expect(recording.setup.enabled).toBe(false);
  expect(recording.chooseFolder.enabled).toBe(false);

  const his = model.card({ ...READY, recording: true, owned: false, elapsedMs: 5000, outputPath: 'C:/x.mp4', sidecar: null });
  expect(his.details[0]).toBe('C:/x.mp4 · started in OBS');
  expect(his.details[1]).toBe('No sim session is live, so no telemetry is written beside this one.');

  const closed = model.card({ ...READY, obs: 'closed', setup: { ...READY.setup, wsEnabled: false, needed: true } });
  expect(closed.line).toBe('OBS is not open');
  expect(closed.openObs).toEqual({ show: true, enabled: true });
  expect(closed.setup.show).toBe(true);
  expect(closed.setup.sentence).toMatch(/^Set up OBS will switch on OBS's WebSocket\./);
  expect(closed.details.at(-1)).toBe(closed.setup.sentence);

  const refused = model.card({ ...READY, obs: 'authFailed', needsPassword: true, last: { ok: false, text: "OBS isn't open", at: 1 } });
  expect(refused.password.show).toBe(true);
  expect(refused.password.hint).toMatch(/Tools, WebSocket Server Settings/);
  expect(refused.details).toContain("OBS isn't open");
  expect(refused.details.some((d) => /refused the password/.test(d))).toBe(true);
  const typed = model.card({ ...READY, obs: 'authFailed', needsPassword: true, passwordTyped: true });
  expect(typed.password.hint).toMatch(/you typed is kept/);

  const low = model.card({ ...READY, lowDisk: 'Recording stopped: only 4.0 GB left on D:.', free: { bytes: 4e9, hoursLeft: 0.09, drive: 'D:' } });
  expect(low.details[0]).toBe('Recording stopped: only 4.0 GB left on D:.');
  expect(low.details[1]).toBe('About 5 minutes of recording left on D: at 100 Mbps.');

  const unreadable = model.card({ ...READY, setup: { ...READY.setup, wsState: 'unreadable', wsEnabled: null, needed: true } });
  expect(unreadable.password.show).toBe(true);
  expect(unreadable.details.some((d) => /could not be read/.test(d))).toBe(true);

  const missing = model.card({ ...READY, obs: 'closed', setup: { ...READY.setup, obsFound: false } });
  // Said as it is, with no instruction to a control that is not there (there is no field for OBS's folder).
  expect(missing.details).toContain('OBS was not found at C:\\Program Files\\obs-studio, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.');
  expect(missing.details.join(' ')).not.toMatch(/Set its folder|below/);
});

test('without the app the card is read-only and says so', () => {
  const card = model.card(null, { inApp: false });
  expect(card.line).toBe('This is switched from the Racing Desk app.');
  expect(card.record.enabled).toBe(false);
  expect(card.saveReplay.show).toBe(false);
  expect(card.openObs.show).toBe(false);
  expect(card.setup.show).toBe(false);
  expect(card.switches.every((s) => s.enabled === false)).toBe(true);
  expect(card.switches.map((s) => s.value)).toEqual([true, false, true, true, false]);
});

test('Save replay is there while Instant replay is on and pressable while the buffer runs; the card says what the buffer is doing and what was saved', () => {
  const off = model.card(READY);
  expect(off.saveReplay).toEqual({ show: false, enabled: false });
  expect(model.replaySentence(READY)).toBeNull();
  const waiting = model.card({ ...READY, replay: { on: true, running: false, unavailable: null, lastSaved: null } });
  expect(waiting.saveReplay).toEqual({ show: true, enabled: false });
  expect(waiting.details).toContain('Instant replay runs while you are in the car.');
  const running = model.card({ ...READY, replay: { on: true, running: true, unavailable: null, lastSaved: null } });
  expect(running.saveReplay).toEqual({ show: true, enabled: true });
  expect(running.details).toContain('Instant replay is on: Ctrl+Shift+B, the tray or the Stream Deck saves the last seconds.');
  const none = model.card({ ...READY, replay: { on: true, running: false, unavailable: 'OBS has no replay buffer. Press Set up OBS, then open OBS again.', lastSaved: null } });
  expect(none.details).toContain('OBS has no replay buffer. Press Set up OBS, then open OBS again.');
  expect(none.saveReplay.enabled).toBe(false);
  const saved = model.card({ ...READY, replay: { on: true, running: true, unavailable: null, lastSaved: { path: 'D:\\R\\Replay 2026-09-30 21-20-00.mp4', sidecar: 'x', at: 1, frames: 600 } } });
  expect(saved.details).toContain('Replay saved: D:\\R\\Replay 2026-09-30 21-20-00.mp4');
  // Not pressable while busy, or with OBS gone.
  expect(model.card({ ...READY, busy: 'saving', replay: { on: true, running: true, unavailable: null, lastSaved: null } }).saveReplay.enabled).toBe(false);
  expect(model.card({ ...READY, obs: 'closed', replay: { on: true, running: true, unavailable: null, lastSaved: null } }).saveReplay.enabled).toBe(false);
});

test('where the last recording went is said once it is not recording: the folder with its chapters and replays, or where it stayed and why', () => {
  const filed = { at: 1, folder: 'D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup', video: 'x', sidecar: 'y', chapters: 7, clips: 1, alignment: { method: 'chapters' }, why: null };
  expect(model.filedSentence({ ...READY, lastFiled: filed })).toBe('The last recording is in D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup (7 chapters, 1 replay).');
  expect(model.filedSentence({ ...READY, lastFiled: { ...filed, chapters: 1, clips: 0 } })).toBe('The last recording is in D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup (1 chapter).');
  expect(model.filedSentence({ ...READY, lastFiled: { ...filed, chapters: 0, clips: 0 } })).toBe('The last recording is in D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup.');
  expect(model.filedSentence({ ...READY, lastFiled: { ...filed, folder: null, video: 'C:/Users/x/Videos/NVIDIA/a.mp4', why: 'c: and d: are different drives' } })).toBe('The last recording stayed where OBS wrote it, C:/Users/x/Videos/NVIDIA/a.mp4: c: and d: are different drives.');
  expect(model.filedSentence(READY)).toBeNull();
  expect(model.card({ ...READY, lastFiled: filed }).details[0]).toMatch(/^The last recording is in /);
  // While recording it is not said: the recording's own sentences are.
  expect(model.card({ ...READY, recording: true, owned: true, lastFiled: filed, outputPath: 'a.mp4' }).details.join(' ')).not.toMatch(/The last recording/);
});
