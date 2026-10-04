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

test("the recordings' size: the button's sentence says the recordings keep their size, named as the profile has it, with a quality target, with OBS closed; with OBS open a sentence of its own says it waits", () => {
  // Nothing known of the encoder (not NVENC, or no profile): not a word of size.
  expect(model.setupSentence({ ...READY, setup: { ...READY.setup, qualityTarget: null, needed: false } })).toBeNull();
  expect(model.setupSentence({ ...READY, obs: 'closed', setup: { ...READY.setup, qualityTarget: true, needed: false } })).toBeNull();
  // OBS closed, everything else done: the one change, and his own Ctrl+Space recordings get it too (one profile).
  const onlySize = { ...READY, obs: 'closed', setup: { ...READY.setup, qualityTarget: false, capKbps: 100000, outputSize: '2580x1080', needed: true } };
  // The size is the one the profile records at (his canvas is 3440x1440, his recordings are 2580x1080): never "full size", which reads as the canvas.
  expect(model.setupSentence(onlySize)).toBe('Set up OBS will keep its recordings at 2580x1080 with a quality target instead of a fixed 100 Mbps. Your own Ctrl+Space recordings keep their size with a quality target too.');
  // The profile not saying its size: the size is not named, and nothing is said of it being full.
  expect(model.setupSentence({ ...onlySize, setup: { ...onlySize.setup, outputSize: null } })).toBe('Set up OBS will give its recordings a quality target instead of a fixed 100 Mbps. Your own Ctrl+Space recordings keep their size with a quality target too.');
  expect(model.sizeNextTimeSentence(onlySize)).toBeNull();
  const card = model.card(onlySize);
  expect(card.setup).toEqual({ show: true, enabled: true, sentence: model.setupSentence(onlySize) });
  // The cap is his, as the setup status read it from the profile; 100 Mbps when it did not say.
  expect(model.setupSentence({ ...onlySize, setup: { ...onlySize.setup, capKbps: 60000 } })).toMatch(/instead of a fixed 60 Mbps\./);
  expect(model.setupSentence({ ...onlySize, setup: { ...onlySize.setup, capKbps: null } })).toMatch(/instead of a fixed 100 Mbps\./);
  // With everything missing, the size change is the last of the list, and the last of what changes for his own recordings.
  const fresh = { ...READY, obs: 'closed', setup: { ...READY.setup, wsEnabled: false, hybrid: false, replayBuffer: false, folderSet: false, qualityTarget: false, capKbps: 100000, outputSize: '2580x1080', needed: true } };
  expect(model.setupSentence(fresh)).toBe(
    "Set up OBS will switch on OBS's WebSocket, set your profile to Hybrid MP4, turn its 20 s replay buffer on, point its recordings at D:\\Racing Desk\\Recordings and keep its recordings at 2580x1080 with a quality target instead of a fixed 100 Mbps. "
    + 'Your own Ctrl+Space recordings become Hybrid MP4, go to D:\\Racing Desk\\Recordings and keep their size with a quality target too. OBS then answers on port 4455 to anything on your network that knows the password.',
  );
  // OBS open: the encoder file can only be written with OBS closed, so the button's sentence leaves the size out — with
  // nothing else to do there is no button — and the card says in one sentence when the change happens.
  const openOnlySize = { ...onlySize, obs: 'open' };
  expect(model.setupSentence(openOnlySize)).toBeNull();
  expect(model.sizeNextTimeSentence(openOnlySize)).toBe('The size change (a quality target instead of a fixed 100 Mbps; the recordings stay 2580x1080) happens the next time Set up OBS runs with OBS closed.');
  expect(model.sizeNextTimeSentence({ ...openOnlySize, setup: { ...openOnlySize.setup, outputSize: null } })).toBe('The size change (a quality target instead of a fixed 100 Mbps) happens the next time Set up OBS runs with OBS closed.');
  const openCard = model.card(openOnlySize);
  expect(openCard.setup.show).toBe(false);
  expect(openCard.details).toEqual([
    'About 9 hours of recording left on D: at 100 Mbps.',
    'The size change (a quality target instead of a fixed 100 Mbps; the recordings stay 2580x1080) happens the next time Set up OBS runs with OBS closed.',
  ]);
  const openAndFolder = { ...openOnlySize, setup: { ...openOnlySize.setup, folderSet: false } };
  expect(model.setupSentence(openAndFolder)).toBe('Set up OBS will point its recordings at D:\\Racing Desk\\Recordings. Your own Ctrl+Space recordings go to D:\\Racing Desk\\Recordings too.');
  expect(model.card(openAndFolder).details.slice(-2)).toEqual([model.sizeNextTimeSentence(openAndFolder), model.setupSentence(openAndFolder)]);
  // Once set, nothing of size on the card.
  expect(model.card({ ...READY, setup: { ...READY.setup, qualityTarget: true, capKbps: 100000 } }).details.some((d) => /size change/.test(d))).toBe(false);
});

test('the hours left run at the real rate of his recordings once there is one, and say so in GB an hour; until then at the cap, said as "or more" with nothing of the rate', () => {
  expect(model.formatGbPerHour(12.5e6)).toBe('45 GB an hour');
  expect(model.formatGbPerHour(5e6)).toBe('18 GB an hour');
  expect(model.formatGbPerHour(2.5e6)).toBe('9.0 GB an hour');
  // The rate the app says it uses: measured from the files, with how many.
  const measured = { ...READY, rateFrom: 'measured', bytesPerSecond: 5e6, measured: { bytesPerSecond: 5e6, gbPerHour: 18, recordings: 3 }, free: { bytes: 400e9, hoursLeft: 400e9 / 5e6 / 3600, drive: 'D:' } };
  expect(model.hoursLeftSentence(measured)).toBe('About 22 hours of recording left on D: at 18 GB an hour, measured from your last 3 recordings.');
  expect(model.hoursLeftSentence({ ...measured, measured: { ...measured.measured, recordings: 1 } })).toBe('About 22 hours of recording left on D: at 18 GB an hour, measured from your last recording.');
  expect(model.card(measured).details).toEqual(['About 22 hours of recording left on D: at 18 GB an hour, measured from your last 3 recordings.']);
  // Nothing measured yet, the quality target set: the cap is the most the rate can be, so the hours are that many or more; not a word of the rate (or of size) until a recording says.
  const capped = { ...READY, rateFrom: 'configured', measured: null, setup: { ...READY.setup, qualityTarget: true, capKbps: 100000 } };
  expect(model.hoursLeftSentence(capped)).toBe('About 9 hours or more of recording left on D:.');
  expect(model.hoursLeftSentence(capped)).not.toMatch(/Mbps|GB|rate|cap|least/);
  // Nothing measured and a fixed bitrate (not set up yet): the sentence as it was.
  expect(model.hoursLeftSentence({ ...READY, rateFrom: 'configured', measured: null, setup: { ...READY.setup, qualityTarget: false } })).toBe('About 9 hours of recording left on D: at 100 Mbps.');
  expect(model.hoursLeftSentence(READY)).toBe('About 9 hours of recording left on D: at 100 Mbps.');   // an app that says nothing of where the rate is from
  // While recording, OBS's own rate, in Mbps.
  const live = { ...READY, recording: true, owned: true, outputPath: 'D:/x.mp4', rateFrom: 'live', bytesPerSecond: 5.25e6, measured: { bytesPerSecond: 5e6, gbPerHour: 18, recordings: 3 }, free: { bytes: 400e9, hoursLeft: 400e9 / 5.25e6 / 3600, drive: 'D:' } };
  expect(model.hoursLeftSentence(live)).toBe('About 21 hours of recording left on D: at 42 Mbps.');
  expect(model.hoursLeftSentence({ ...READY, free: null })).toBeNull();
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
    ['recordingAutoRecord', true, true], ['recordingInstantReplay', false, true], ['recordingChapters', true, true], ['obsStartOnRecord', true, true],
    ['obsHudSource', false, true], ['tvShotsHideFacecam', true, true],
  ]);
  // "HUD drawn by OBS", on: what it has done, from the app's last word on it — named for what it draws.
  expect(model.card({ ...READY, obsHudSource: true, obs: 'closed' }).details).toContain('HUD drawn by OBS: the HUD goes into your scenes when OBS opens.');
  expect(model.card({ ...READY, obsHudSource: true }).details).toContain('HUD drawn by OBS: the HUD is being put into your scenes.');
  expect(model.card({ ...READY, obsHudSource: true, obsHudView: 'ipad', obs: 'closed' }).details).toContain('HUD drawn by OBS: the iPad dashboard goes into your scenes when OBS opens.');
  expect(model.card({ ...READY, obsHudSource: true, obsHudView: 'ipad' }).details).toContain('HUD drawn by OBS: the iPad dashboard is being put into your scenes.');
  expect(model.card({ ...READY, obsHudSource: true, obsHudView: 'ipad', hudSource: { last: { ok: true, did: 'The iPad dashboard is a browser source in 3 of your scenes, in its corner over the game.', problems: [] } } }).details)
    .toContain('HUD drawn by OBS: The iPad dashboard is a browser source in 3 of your scenes, in its corner over the game.');
  expect(model.card({ ...READY, obsHudSource: true, hudSource: { last: { ok: true, did: 'The HUD is a browser source in 3 of your scenes, just above the game.', problems: [] } } }).details)
    .toContain('HUD drawn by OBS: The HUD is a browser source in 3 of your scenes, just above the game.');
  expect(model.card({ ...READY, obsHudSource: true, hudSource: { last: { ok: false, did: null, problems: ['OBS did not take the HUD source: gone'] } } }).details)
    .toContain('HUD drawn by OBS: OBS did not take the HUD source: gone');
  expect(model.card({ ...READY, hudSource: { last: { ok: true, did: 'x', problems: [] } } }).details.some((d) => /HUD drawn/.test(d))).toBe(false);   // off: not a word
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

test('TV shots: the pill is theirs while they run, with Stop; the card says how they went; the race detail has the button for a race with a recording', () => {
  const running = { ...READY, tv: { running: true, step: 'recording', index: 3, total: 7, label: 'P5 → P4', result: null } };
  expect(model.stateLine(running)).toBe('TV shots 3 of 7');
  expect(model.pill(running)).toEqual({ text: 'TV shots 3 of 7', state: 'busy', detail: 'TV shots: recording moment 3 of 7 — P5 → P4.', button: { label: 'Stop', enabled: true, command: 'tvShotsCancel' } });
  expect(model.pill({ ...running, tv: { ...running.tv, step: 'cancelling' } }).button).toEqual({ label: 'Stop', enabled: false, command: 'tvShotsCancel' });
  expect(model.stateLine({ ...running, tv: { ...running.tv, step: 'preparing' } })).toBe('TV shots: getting ready');
  expect(model.stateLine({ ...running, tv: { ...running.tv, step: 'filing' } })).toBe('TV shots: filing the take');
  expect(model.card({ ...running, tv: { ...running.tv, step: 'seeking' } }).details).toContain('TV shots: finding moment 3 of 7 in the replay — P5 → P4.');
  // Over: what came of them.
  const done = { ...READY, tv: { running: false, step: 'done', result: { ok: true, moments: 7, video: 'D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort\\2026-09-29 22-13-22 tv.mp4' } } };
  expect(model.stateLine(done)).toBe('OBS is open, not recording');
  expect(model.pill(done).button.command).toBe('toggle');
  expect(model.card(done).details).toContain('TV shots done: 7 moments, in D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort\\2026-09-29 22-13-22 tv.mp4.');
  expect(model.tvSentence({ tv: { running: false, result: { ok: false, cancelled: true, moments: 2, video: 'x.mp4' } } })).toBe('TV shots stopped after 2 moments; what was recorded is in x.mp4.');
  // A moment the sim did not reach is skipped, and said, here and in the result.
  expect(model.tvSentence({ tv: { running: true, step: 'skipped', index: 2, total: 3, label: 'Incident ×2' } })).toBe('TV shots: moment 2 of 3 is not in the replay, so it is skipped — Incident ×2.');
  expect(model.tvSentence({ tv: { running: false, result: { ok: true, moments: 2, skipped: 1, video: 'x.mp4' } } })).toBe('TV shots done: 2 moments (1 was not in the replay), in x.mp4.');
  expect(model.tvSentence({ tv: { running: false, result: { ok: true, moments: 2, skipped: 2, video: 'x.mp4' } } })).toBe('TV shots done: 2 moments (2 were not in the replay), in x.mp4.');
  expect(model.tvSentence({ tv: { running: false, result: { ok: false, cancelled: false, moments: 0, reason: "iRacing isn't in its replay." } } })).toBe("TV shots were not made: iRacing isn't in its replay.");
  expect(model.tvSentence({ tv: { running: false, result: null } })).toBeNull();
  expect(model.tvSentence(READY)).toBeNull();
  // A TV take recording reads as one.
  expect(model.card({ ...READY, recording: true, owned: true, kind: 'tv', elapsedMs: 5000, bytes: 1e9, outputPath: 'x.mp4' }).details[0]).toBe('1.0 GB · x.mp4 · a TV take');
  // The race detail.
  const rec = { folder: 'D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort', name: '2026-09-29 22-13 Zandvoort', take: null, clips: 2 };
  expect(model.raceTv(READY, null)).toMatchObject({ show: false, button: null });
  expect(model.raceTv(READY, rec)).toEqual({ show: true, line: 'Recording: 2026-09-29 22-13 Zandvoort · 2 replays', button: { label: 'TV shots', command: 'tvShots', enabled: true, hint: "From iRacing's replay of this race, through a TV camera, into this recording's folder." } });
  expect(model.raceTv(READY, { ...rec, take: 'x tv.mp4', clips: 0 })).toMatchObject({ line: 'Recording: 2026-09-29 22-13 Zandvoort (TV shots made)', button: { label: 'TV shots again', enabled: true } });
  expect(model.raceTv({ ...READY, obs: 'closed' }, rec).button).toMatchObject({ enabled: false, hint: 'Needs OBS open and nothing recording.' });
  expect(model.raceTv({ ...READY, recording: true }, rec).button.enabled).toBe(false);
  expect(model.raceTv(running, rec).button).toEqual({ label: 'Stop TV shots', command: 'tvShotsCancel', enabled: true });
  expect(model.raceTv(null, rec).button.enabled).toBe(false);
});

test('without the app the card is read-only and says so', () => {
  const card = model.card(null, { inApp: false });
  expect(card.line).toBe('This is switched from the Racing Desk app.');
  expect(card.record.enabled).toBe(false);
  expect(card.saveReplay.show).toBe(false);
  expect(card.openObs.show).toBe(false);
  expect(card.setup.show).toBe(false);
  expect(card.switches.every((s) => s.enabled === false)).toBe(true);
  expect(card.switches.map((s) => s.value)).toEqual([true, false, true, true, false, false, true]);
  expect(card.view).toMatchObject({ key: 'obsHudView', value: 'rig', enabled: false });
  expect(card.panelBackground).toMatchObject({ key: 'obsPanelBackground', value: 90, enabled: false });
});

test('what OBS draws is a choice under the switch, Rig HUD or iPad dashboard with a sentence each, Rig HUD unless the file says ipad; the panel background for OBS is a slider of its own, 90 unless the file says, held to 0 to 100', () => {
  expect(model.HUD_VIEW).toMatchObject({ key: 'obsHudView', label: 'What OBS draws', def: 'rig' });
  expect(model.HUD_VIEW.options.map(([value, label]) => [value, label])).toEqual([['rig', 'Rig HUD'], ['ipad', 'iPad dashboard']]);
  for (const [, , sentence] of model.HUD_VIEW.options) expect(sentence).toMatch(/^[A-Z][^.]+\.$/);
  expect(model.HUD_VIEW.options[1][2]).toMatch(/corner/);
  expect(model.hudViewOf(READY)).toBe('rig');
  expect(model.hudViewOf({ ...READY, obsHudView: 'ipad' })).toBe('ipad');
  expect(model.hudViewOf({ ...READY, obsHudView: 'television' })).toBe('rig');
  expect(model.hudViewOf(null)).toBe('rig');
  expect(model.card(READY).view).toMatchObject({ key: 'obsHudView', value: 'rig', enabled: true });
  expect(model.card({ ...READY, obsHudView: 'ipad' }).view.value).toBe('ipad');
  expect(model.OBS_PANEL_BACKGROUND).toMatchObject({ key: 'obsPanelBackground', def: 90, min: 0, max: 100, step: 5, unit: '%' });
  expect(model.OBS_PANEL_BACKGROUND.hint).toMatch(/game show through/);
  expect(model.obsPanelBackgroundOf(READY)).toBe(90);
  expect(model.obsPanelBackgroundOf({ ...READY, obsPanelBackground: 35 })).toBe(35);
  expect(model.obsPanelBackgroundOf({ ...READY, obsPanelBackground: 150 })).toBe(100);
  expect(model.obsPanelBackgroundOf({ ...READY, obsPanelBackground: -1 })).toBe(0);
  expect(model.obsPanelBackgroundOf({ ...READY, obsPanelBackground: 'thin' })).toBe(90);
  expect(model.obsPanelBackgroundOf({ ...READY, obsPanelBackground: NaN })).toBe(90);
  expect(model.card({ ...READY, obsPanelBackground: 35 }).panelBackground).toMatchObject({ value: 35, enabled: true });
  // The switches are as they were: the choice and the slider are beside them, not among them.
  expect(model.SWITCHES.map((s) => s.key)).not.toContain('obsHudView');
  expect(model.SWITCHES.map((s) => s.key)).not.toContain('obsPanelBackground');
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
