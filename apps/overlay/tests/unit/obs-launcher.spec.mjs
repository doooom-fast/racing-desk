/**
 * Finding, starting and setting up OBS (modules/js/obs/launcher.js), with every file, process list and spawn a fake:
 * the real %APPDATA%\obs-studio is never opened here and obs64.exe never started. Every path a fake sees is asserted
 * to lie inside the test's temp folder, and the fake spawn only records.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const launcher = require('../../modules/js/obs/launcher.js');

const REAL_OBS = path.join(process.env.APPDATA || 'C:\\nowhere', 'obs-studio').toLowerCase();

// The fake file system: real reads and writes, but only under `root`, and every path recorded.
function fakeFs(root) {
  const touched = [];
  const guard = (p) => {
    const s = String(p);
    touched.push(s);
    if (s.toLowerCase().startsWith(REAL_OBS)) throw new Error(`the real OBS folder was touched: ${s}`);
    if (!s.toLowerCase().startsWith(root.toLowerCase())) throw new Error(`a path outside the test folder was touched: ${s}`);
    return s;
  };
  return {
    touched,
    readFile: (p, enc) => fs.readFileSync(guard(p), enc),
    writeFile: (p, data, enc) => fs.writeFileSync(guard(p), data, enc),
    rename: (a, b) => fs.renameSync(guard(a), guard(b)),
    mkdir: (p, o) => fs.mkdirSync(guard(p), o),
    readdir: (p) => fs.readdirSync(guard(p)),
    exists: (p) => fs.existsSync(guard(p)),
  };
}

const WS_FILE = (enabled, password = 'sixteen-chars-pw') => JSON.stringify({
  alerts_enabled: false, auth_required: true, first_load: false, server_enabled: enabled, server_password: password, server_port: 4455,
}, null, 2) + '\n';

const BASIC_INI = '\ufeff[General]\nName=Untitled\n\n[Output]\nMode=Advanced\nFilenameFormatting=%CCYY-%MM-%DD %hh-%mm-%ss\n\n[SimpleOutput]\nFilePath=C:\\\\Users\\\\Driver\\\\Videos\nRecFormat2=mp4\nRecRB=false\nRecRBTime=20\n\n[AdvOut]\nRecType=Standard\nRecFilePath=C:/Users/Driver/Videos/NVIDIA\nRecFormat2=mp4\nRecEncoder=obs_nvenc_h264_tex\nRecSplitFileTime=15\nRecRB=false\nRecRBTime=20\nRecRBSize=512\n\n[Video]\nBaseCX=3440\n\n[Hotkeys]\nOBSBasic.StartRecording={"bindings":[{"control":true,"key":"OBS_KEY_SPACE"}]}\n';
const USER_INI = '[General]\n\n[BasicWindow]\nSysTrayEnabled=true\n\n[Basic]\nProfile=Untitled\nProfileDir=Untitled\nSceneCollection=sim race 2k\nSceneCollectionFile=sim_race_2k.json\n';
// His recording encoder's file as OBS 32.1.2 writes it (one line, no spaces, only the keys he changed): 100 Mbps CBR, preset p2.
const ENCODER_JSON = '{"rate_control":"CBR","bitrate":100000,"preset":"p2"}';
const QUALITY_SENTENCE = 'The profile "Untitled" now records full size with a quality target instead of a fixed 100 Mbps (its encoder settings as they were are kept beside it as recordEncoder.json.before-racing-desk).';

let root;
let appData;
let f;
test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-obs-launcher-'));
  appData = path.join(root, 'Roaming');
  const where = launcher.obsPaths(appData);
  fs.mkdirSync(path.dirname(where.configJson), { recursive: true });
  fs.mkdirSync(path.join(where.profilesDir, 'Untitled'), { recursive: true });
  fs.mkdirSync(path.join(where.profilesDir, 'yersy'), { recursive: true });
  fs.mkdirSync(where.sentinelDir, { recursive: true });
  fs.writeFileSync(where.configJson, WS_FILE(false));
  fs.writeFileSync(where.userIni, USER_INI);
  fs.writeFileSync(path.join(where.profilesDir, 'Untitled', 'basic.ini'), BASIC_INI);
  fs.writeFileSync(path.join(where.profilesDir, 'Untitled', 'recordEncoder.json'), ENCODER_JSON);
  fs.writeFileSync(path.join(where.profilesDir, 'yersy', 'basic.ini'), '\ufeff[Output]\nMode=Simple\n');
  f = fakeFs(root);
});
const encoderFile = () => path.join(launcher.obsPaths(appData).profilesDir, 'Untitled', 'recordEncoder.json');
test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test.describe('finding and starting OBS', () => {
  test('the exe is where he set it, as an exe, its bin folder or the install folder, else the default install', () => {
    const install = path.join(root, 'obs-studio');
    const exe = path.join(install, 'bin', '64bit', 'obs64.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    for (const given of [exe, path.dirname(exe), install]) {
      expect(launcher.findObs({ obsPath: given, exists: f.exists })).toEqual({ exe, cwd: path.dirname(exe) });
    }
    // Nothing set, and nothing at the default install: null. The default is looked for and nothing else is opened.
    expect(launcher.findObs({ obsPath: null, exists: () => false })).toBeNull();
    const asked = [];
    launcher.findObs({ obsPath: '', exists: (p) => { asked.push(p); return false; } });
    expect(asked).toEqual(['C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe']);
  });

  test('OBS is started detached, from its bin folder, minimised to the tray and without the update check, and never anything else', () => {
    const spawned = [];
    const spawn = (exe, args, opts) => { spawned.push({ exe, args, opts }); return { pid: 4242, unref() { spawned[spawned.length - 1].unref = true; } }; };
    const exe = path.join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe');
    const result = launcher.startObs({ exe, cwd: path.dirname(exe), spawn });
    expect(result).toEqual({ ok: true, pid: 4242 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].exe).toBe(exe);
    expect(spawned[0].args).toEqual(['--minimize-to-tray', '--disable-updater']);
    expect(spawned[0].opts).toMatchObject({ cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    expect(spawned[0].unref).toBe(true);
    // No flag names a collection, a profile, a port or a password: OBS logs its whole command line.
    expect(spawned[0].args.join(' ')).not.toMatch(/collection|profile|websocket|password|port/i);
    const failed = launcher.startObs({ exe, cwd: path.dirname(exe), spawn: () => { throw new Error('ENOENT'); } });
    expect(failed).toEqual({ ok: false, reason: 'OBS could not be started: ENOENT' });
  });

  test('whether OBS runs is read from tasklist, and a tasklist that fails is "not known"', async () => {
    const calls = [];
    const exec = async (file, args) => { calls.push([file, ...args]); return { stdout: '"obs64.exe","1234","Console","1","300,000 K"\r\n' }; };
    expect(await launcher.isObsRunning({ exec })).toBe(true);
    expect(calls).toEqual([['tasklist', '/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH']]);
    expect(await launcher.isObsRunning({ exec: async () => ({ stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' }) })).toBe(false);
    expect(await launcher.isObsRunning({ exec: async () => { throw new Error('no tasklist'); } })).toBeNull();
  });

  test('a run_ file left in .sentinel is a crash last time; an empty or missing folder is not', () => {
    const { sentinelDir } = launcher.obsPaths(appData);
    expect(launcher.crashedLastTime({ sentinelDir, readdir: f.readdir })).toBe(false);
    fs.writeFileSync(path.join(sentinelDir, 'run_1727740000'), '');
    expect(launcher.crashedLastTime({ sentinelDir, readdir: f.readdir })).toBe(true);
    expect(launcher.crashedLastTime({ sentinelDir: path.join(root, 'nowhere'), readdir: f.readdir })).toBe(false);
  });
});

test.describe("the WebSocket's settings file", () => {
  test('is read for its switch, port and password; the password goes to the caller and nowhere else', () => {
    const { configJson } = launcher.obsPaths(appData);
    const cfg = launcher.readWebSocketConfig(configJson, { readFile: f.readFile });
    expect(cfg).toEqual({ state: 'ok', enabled: false, port: 4455, authRequired: true, password: 'sixteen-chars-pw' });
    fs.writeFileSync(configJson, '\ufeff' + JSON.stringify({ server_enabled: true, auth_required: false, server_port: 4466 }));
    expect(launcher.readWebSocketConfig(configJson, { readFile: f.readFile })).toEqual({ state: 'ok', enabled: true, port: 4466, authRequired: false, password: null });
    expect(launcher.readWebSocketConfig(path.join(root, 'none.json'), { readFile: f.readFile }).state).toBe('missing');
    fs.writeFileSync(configJson, '{ broken');
    expect(launcher.readWebSocketConfig(configJson, { readFile: f.readFile }).state).toBe('unreadable');
  });

  test('switching the server on changes that one key, keeps the rest and the layout, and goes through a temp file', () => {
    const { configJson } = launcher.obsPaths(appData);
    const result = launcher.enableWebSocket(configJson, f);
    expect(result).toEqual({ changed: true, state: 'ok' });
    const text = fs.readFileSync(configJson, 'utf8');
    expect(text).toBe(WS_FILE(true));
    expect(JSON.parse(text).server_password).toBe('sixteen-chars-pw');
    expect(fs.existsSync(`${configJson}.racing-desk.tmp`)).toBe(false);
    expect(f.touched.some((p) => p.endsWith('.racing-desk.tmp'))).toBe(true);
    // Already on: nothing is written.
    const before = fs.statSync(configJson).mtimeMs;
    expect(launcher.enableWebSocket(configJson, f)).toEqual({ changed: false, state: 'ok' });
    expect(fs.statSync(configJson).mtimeMs).toBe(before);
  });

  test('a file that cannot be read is left as it is; a missing one is made with the one key', () => {
    const { configJson } = launcher.obsPaths(appData);
    fs.writeFileSync(configJson, '{ broken');
    const left = launcher.enableWebSocket(configJson, f);
    expect(left.changed).toBe(false);
    expect(left.state).toBe('unreadable');
    expect(left.reason).toMatch(/left as it is/);
    expect(fs.readFileSync(configJson, 'utf8')).toBe('{ broken');
    const fresh = path.join(root, 'Roaming', 'obs-studio', 'plugin_config', 'other', 'config.json');
    expect(launcher.enableWebSocket(fresh, f)).toEqual({ changed: true, state: 'missing' });
    expect(JSON.parse(fs.readFileSync(fresh, 'utf8'))).toEqual({ server_enabled: true });
  });
});

test.describe("the profile's basic.ini", () => {
  test('the current profile is user.ini\'s ProfileDir, and a name that is a path is refused', () => {
    const { userIni, profilesDir } = launcher.obsPaths(appData);
    expect(launcher.currentProfileIni({ appData, readFile: f.readFile })).toEqual({ profile: 'Untitled', dir: 'Untitled', ini: path.join(profilesDir, 'Untitled', 'basic.ini'), encoder: path.join(profilesDir, 'Untitled', 'recordEncoder.json') });
    fs.writeFileSync(userIni, '[Basic]\nProfileDir=..\\..\\elsewhere\n');
    expect(launcher.currentProfileIni({ appData, readFile: f.readFile })).toBeNull();
    expect(launcher.currentProfileIni({ appData: path.join(root, 'nope'), readFile: (p) => fs.readFileSync(p) })).toBeNull();
  });

  test('keys are read as OBS reads them, and set in place with the BOM, the other lines and the newline style kept', () => {
    expect(launcher.readIniKeys(BASIC_INI, 'AdvOut', ['RecFormat2', 'RecRB', 'RecFilePath', 'Missing'])).toEqual({ RecFormat2: 'mp4', RecRB: 'false', RecFilePath: 'C:/Users/Driver/Videos/NVIDIA', Missing: null });
    expect(launcher.readIniKeys(BASIC_INI, 'SimpleOutput', ['FilePath'])).toEqual({ FilePath: 'C:\\Users\\Driver\\Videos' });
    const next = launcher.setIniKeys(BASIC_INI, launcher.profileWanted('D:\\Racing Desk\\Recordings'));
    expect(next.charCodeAt(0)).toBe(0xfeff);
    expect(next).not.toContain('\r\n');
    expect(launcher.readIniKeys(next, 'AdvOut', ['RecFormat2', 'RecRB', 'RecRBTime', 'RecFilePath', 'RecEncoder', 'RecType'])).toEqual({
      RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '20', RecFilePath: 'D:/Racing Desk/Recordings', RecEncoder: 'obs_nvenc_h264_tex', RecType: 'Standard',
    });
    expect(launcher.readIniKeys(next, 'SimpleOutput', ['FilePath', 'RecFormat2'])).toEqual({ FilePath: 'D:/Racing Desk/Recordings', RecFormat2: 'mp4' });
    // The hotkey line, with its braces and quotes, is as it was; so is the order of sections.
    expect(next).toContain('OBSBasic.StartRecording={"bindings":[{"control":true,"key":"OBS_KEY_SPACE"}]}');
    expect(next.indexOf('[SimpleOutput]')).toBeLessThan(next.indexOf('[AdvOut]'));
    expect(next.indexOf('[AdvOut]')).toBeLessThan(next.indexOf('[Video]'));
    // Lines only change where a key changed: the difference is those keys.
    const was = BASIC_INI.split('\n');
    const now = next.split('\n');
    expect(now.length).toBe(was.length);
    const changed = now.filter((line, i) => line !== was[i]);
    expect(changed.sort()).toEqual(['FilePath=D:/Racing Desk/Recordings', 'RecFilePath=D:/Racing Desk/Recordings', 'RecFormat2=hybrid_mp4', 'RecRB=true'].sort());
    // A key or section that is not there is added; CRLF files stay CRLF.
    const crlf = launcher.setIniKeys('[Output]\r\nMode=Simple\r\n', { AdvOut: { RecRB: 'true' }, Output: { Extra: '1' } });
    expect(crlf).toBe('[Output]\r\nMode=Simple\r\nExtra=1\r\n[AdvOut]\r\nRecRB=true\r\n');
  });

  test('a buffer that is on and the wrong length is not "set up": the check says so, and so does the sentence about what will change', () => {
    const wrong = launcher.setIniKeys(BASIC_INI, { AdvOut: { RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '60', RecFilePath: 'D:/Racing Desk/Recordings' } });
    expect(launcher.profileCheck(wrong, 'D:\\Racing Desk\\Recordings')).toMatchObject({ hybrid: true, replayBuffer: true, replaySeconds: false, folder: true, ok: false });
    // OBS's own default is 20 s: a key that is not there is the wanted length.
    const absent = wrong.split('\n').filter((line) => line !== 'RecRBTime=60').join('\n');
    expect(launcher.profileCheck(absent, 'D:\\Racing Desk\\Recordings')).toMatchObject({ replaySeconds: true, ok: true });
  });

  test('the check says what is missing', () => {
    expect(launcher.profileCheck(BASIC_INI, 'D:\\Racing Desk\\Recordings')).toMatchObject({ hybrid: false, replayBuffer: false, folder: false, ok: false });
    const done = launcher.setIniKeys(BASIC_INI, launcher.profileWanted('D:\\Racing Desk\\Recordings'));
    expect(launcher.profileCheck(done, 'd:/racing desk/recordings/')).toMatchObject({ hybrid: true, replayBuffer: true, folder: true, ok: true });
  });
});

test.describe('Set up OBS while OBS is closed', () => {
  test('switches the WebSocket on, reads the password into memory, writes the three profile keys and makes the folder; and says what it did', () => {
    const folder = path.join(root, 'Recordings');
    const result = launcher.setupWhileClosed({ appData, folder, ...f });
    expect(result.problems).toEqual([]);
    expect(result.password).toBe('sixteen-chars-pw');
    expect(result.wsPort).toBe(4455);
    expect(result.did).toEqual([
      "OBS's WebSocket is switched on.",
      `The profile "Untitled" now has Hybrid MP4, a 20 s replay buffer, recordings into ${folder}.`,
      QUALITY_SENTENCE,
    ]);
    const { configJson, profilesDir } = launcher.obsPaths(appData);
    expect(JSON.parse(fs.readFileSync(configJson, 'utf8')).server_enabled).toBe(true);
    const ini = fs.readFileSync(path.join(profilesDir, 'Untitled', 'basic.ini'), 'utf8');
    expect(launcher.profileCheck(ini, folder).ok).toBe(true);
    expect(fs.readFileSync(path.join(profilesDir, 'yersy', 'basic.ini'), 'utf8')).toBe('\ufeff[Output]\nMode=Simple\n');   // the other profile untouched
    expect(fs.existsSync(folder)).toBe(true);
    // The encoder file: the three rate-control keys, the rest as it was, and the copy beside it.
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe('{"rate_control":"CQVBR","bitrate":100000,"preset":"p2","target_quality":16,"max_bitrate":100000}');
    expect(fs.readFileSync(`${encoderFile()}.before-racing-desk`, 'utf8')).toBe(ENCODER_JSON);
    // No sentence carries the password.
    for (const s of [...result.did, ...result.problems]) expect(s).not.toContain('sixteen-chars-pw');
    // Every path touched is in the test's folder, none in the real OBS folder (fakeFs throws otherwise).
    expect(f.touched.length).toBeGreaterThan(5);
    // A second run changes nothing and says so.
    const again = launcher.setupWhileClosed({ appData, folder, ...f });
    expect(again.problems).toEqual([]);
    expect(again.did).toEqual([`The profile "Untitled" already records Hybrid MP4 with a replay buffer into ${folder}.`]);
  });

  test('a WebSocket file with the server on but no password yet is said so, with nothing for him to do, and an unreadable profile is a problem, not a throw', () => {
    const { configJson, userIni } = launcher.obsPaths(appData);
    fs.writeFileSync(configJson, JSON.stringify({ server_enabled: true, auth_required: true, server_port: 4455 }));
    fs.writeFileSync(userIni, '[Basic]\nProfileDir=gone\n');
    const result = launcher.setupWhileClosed({ appData, folder: path.join(root, 'R'), ...f });
    expect(result.password).toBeNull();
    expect(result.did.some((p) => /no password in its settings file yet/.test(p))).toBe(true);
    expect(result.problems.some((p) => /profile's settings could not be written/.test(p))).toBe(true);
    // Racing Desk reads the password from OBS's file each time OBS asks, and no password field is shown here, so no sentence
    // sends him to press Set up OBS again or to type one.
    for (const sentence of [...result.did, ...result.problems]) expect(sentence).not.toMatch(/again|type the password|below/i);
  });
});

test.describe('Set up OBS says every change it makes, the length of the replay buffer too', () => {
  test('closed: a buffer that was on and 60 s long is rewritten, and said to be', () => {
    const folder = path.join(root, 'Recordings');
    const { profilesDir } = launcher.obsPaths(appData);
    const ini = path.join(profilesDir, 'Untitled', 'basic.ini');
    fs.writeFileSync(ini, launcher.setIniKeys(BASIC_INI, { AdvOut: { RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '60', RecFilePath: folder.split(path.sep).join('/') } }));
    const result = launcher.setupWhileClosed({ appData, folder, ...f });
    expect(result.did).toContain(`The profile "Untitled" now has the replay buffer 20 s long.`);
    expect(launcher.readIniKeys(fs.readFileSync(ini, 'utf8'), 'AdvOut', ['RecRBTime']).RecRBTime).toBe('20');
    // Run again: nothing left to say.
    expect(launcher.setupWhileClosed({ appData, folder, ...f }).did).toContain(`The profile "Untitled" already records Hybrid MP4 with a replay buffer into ${folder}.`);
  });

  test('open: the same, with the same words, and a length that is not in the profile is left alone (OBS has its own, 20 s)', async () => {
    const calls = [];
    const profile = { AdvOut: { RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '30', RecFilePath: 'D:/Racing Desk/Recordings' }, SimpleOutput: {} };
    const client = {
      async request(type, data) {
        calls.push([type, data]);
        if (type === 'GetProfileParameter') return { parameterValue: profile.AdvOut[data.parameterName] ?? null };
        if (type === 'SetProfileParameter') { profile[data.parameterCategory][data.parameterName] = data.parameterValue; return {}; }
        throw new Error('unexpected ' + type);
      },
    };
    const result = await launcher.setupWhileOpen(client, { folder: 'D:\\Racing Desk\\Recordings' });
    expect(result.did).toEqual(['The profile now has the replay buffer 20 s long. Crash-safe files and instant replay start the next time OBS opens.']);
    expect(profile.AdvOut.RecRBTime).toBe('20');
    // Not in the profile at all: nothing to set, nothing to say.
    delete profile.AdvOut.RecRBTime;
    const sets = calls.filter(([t]) => t === 'SetProfileParameter').length;
    const again = await launcher.setupWhileOpen(client, { folder: 'D:\\Racing Desk\\Recordings' });
    expect(again.did).toEqual(['The profile already records Hybrid MP4 with a replay buffer into D:\\Racing Desk\\Recordings.']);
    expect(calls.filter(([t]) => t === 'SetProfileParameter')).toHaveLength(sets);
  });
});

test.describe('Set up OBS while OBS is open', () => {
  function fakeClient(profile, { recording = false } = {}) {
    const calls = [];
    return {
      calls,
      profile,
      async request(type, data) {
        calls.push([type, data]);
        if (type === 'GetProfileParameter') return { parameterValue: profile.AdvOut[data.parameterName] ?? null, defaultParameterValue: null };
        if (type === 'SetProfileParameter') { profile[data.parameterCategory][data.parameterName] = data.parameterValue; return {}; }
        if (type === 'SetRecordDirectory') {
          if (recording) { const e = new Error('SetRecordDirectory: The output is running'); e.code = 500; throw e; }
          profile.AdvOut.RecFilePath = data.recordDirectory; profile.SimpleOutput.FilePath = data.recordDirectory; return {};
        }
        throw new Error('unexpected ' + type);
      },
    };
  }

  test('sets the keys as strings through SetProfileParameter and the folder through SetRecordDirectory, and says they start at the next OBS start', async () => {
    const client = fakeClient({ AdvOut: { RecFormat2: 'mp4', RecRB: 'false', RecRBTime: '20', RecFilePath: 'C:/Users/Driver/Videos/NVIDIA' }, SimpleOutput: {} });
    const result = await launcher.setupWhileOpen(client, { folder: 'D:\\Racing Desk\\Recordings' });
    expect(result.problems).toEqual([]);
    expect(result.did).toEqual(['The profile now has Hybrid MP4, a 20 s replay buffer, recordings into D:\\Racing Desk\\Recordings. Crash-safe files and instant replay start the next time OBS opens.']);
    expect(client.profile.AdvOut).toEqual({ RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '20', RecFilePath: 'D:/Racing Desk/Recordings' });
    const sets = client.calls.filter(([t]) => t === 'SetProfileParameter').map(([, d]) => d);
    for (const d of sets) expect(typeof d.parameterValue).toBe('string');
    expect(client.calls.some(([t]) => /SetCurrentProfile/.test(t))).toBe(false);   // never the hop through another profile
    // Already set: nothing written, said so.
    const again = await launcher.setupWhileOpen(client, { folder: 'D:\\Racing Desk\\Recordings' });
    expect(again.did).toEqual(['The profile already records Hybrid MP4 with a replay buffer into D:\\Racing Desk\\Recordings.']);
    expect(client.calls.filter(([t]) => t === 'SetProfileParameter')).toHaveLength(sets.length);
  });

  test('while a recording runs the folder is left and said so; the other keys are set', async () => {
    const client = fakeClient({ AdvOut: { RecFormat2: 'mp4', RecRB: 'false', RecRBTime: '20', RecFilePath: 'C:/x' }, SimpleOutput: {} }, { recording: true });
    const result = await launcher.setupWhileOpen(client, { folder: 'D:\\Racing Desk\\Recordings' });
    expect(result.problems).toEqual(['The recording folder was not changed while OBS is recording; press Set up OBS again after it stops.']);
    expect(client.profile.AdvOut.RecFormat2).toBe('hybrid_mp4');
    expect(client.profile.AdvOut.RecFilePath).toBe('C:/x');
  });
});

// ── What the review of stage 1 found ─────────────────────────────────────────────────────────────────────────────

test.describe('starting OBS on a press: never a second, never one that cannot answer', () => {
  const running = '"obs64.exe","1234","Console","1","300,000 K"\r\n';
  const notRunning = 'INFO: No tasks are running which match the specified criteria.\r\n';

  // Everything handed in: an install in the temp folder, a tasklist that answers what it is told, a spawn that records.
  function press({ tasklist = notRunning, enabled = true, config = undefined, delayMs = 0 } = {}) {
    const install = path.join(root, 'obs-studio');
    const exe = path.join(install, 'bin', '64bit', 'obs64.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    const paths = launcher.obsPaths(appData);
    if (config === 'missing') fs.rmSync(paths.configJson);
    else if (config !== undefined) fs.writeFileSync(paths.configJson, config);
    else fs.writeFileSync(paths.configJson, WS_FILE(enabled));
    const spawned = [];
    const asked = [];
    const logged = [];
    const exec = async (file, args) => {
      asked.push([file, ...args]);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (tasklist instanceof Error) throw tasklist;
      return { stdout: tasklist };
    };
    const spawn = (e, args, opts) => { spawned.push({ exe: e, args, opts }); return { pid: 77, unref() {} }; };
    const deps = { exec, paths, obsPath: install, exists: f.exists, readdir: f.readdir, readFile: f.readFile, spawn, log: (l) => logged.push(l) };
    return { deps, spawned, asked, logged };
  }

  test('a tasklist that cannot say whether OBS runs is "not known": nothing is started', async () => {
    const p = press({ tasklist: new Error('tasklist timed out') });
    const answer = await launcher.startIfClosed(p.deps);
    expect(answer).toEqual({ ok: false, reason: 'Racing Desk could not tell whether OBS is open.' });
    expect(p.spawned).toEqual([]);
  });

  test('OBS closed: started detached, once; with its WebSocket switched off (or no settings file yet) it is not, and the sentence is to press Set up OBS first', async () => {
    const on = press({ enabled: true });
    expect(await launcher.startIfClosed(on.deps)).toEqual({ ok: true, pid: 77 });
    expect(on.spawned).toHaveLength(1);
    expect(on.spawned[0].args).toEqual(['--minimize-to-tray', '--disable-updater']);
    expect(on.logged.some((l) => /OBS started \(pid 77\)/.test(l))).toBe(true);

    const off = press({ enabled: false });
    expect(await launcher.startIfClosed(off.deps)).toEqual({ ok: false, reason: launcher.WS_OFF_FIRST });
    expect(launcher.WS_OFF_FIRST).toMatch(/Press Set up OBS first\.$/);
    expect(off.spawned).toEqual([]);

    const none = press({ config: 'missing' });
    expect((await launcher.startIfClosed(none.deps)).reason).toBe(launcher.WS_OFF_FIRST);
    expect(none.spawned).toEqual([]);

    // A settings file that cannot be read says nothing about the switch: OBS is started (the password may be typed).
    const odd = press({ config: '{ broken' });
    expect((await launcher.startIfClosed(odd.deps)).ok).toBe(true);
  });

  test('OBS running: nothing is started; with its WebSocket off the card is told so, else it is open and may be asking about a crash', async () => {
    const open = press({ tasklist: running, enabled: true });
    expect(await launcher.startIfClosed(open.deps)).toEqual({ ok: true, running: true });
    const off = press({ tasklist: running, enabled: false });
    expect(await launcher.startIfClosed(off.deps)).toEqual({ ok: false, reason: launcher.WS_OFF_OPEN });
    expect(open.spawned.length + off.spawned.length).toBe(0);
  });

  test('OBS not found: said in words he can follow, and nothing else is opened', async () => {
    const p = press();
    const answer = await launcher.startIfClosed({ ...p.deps, obsPath: null, exists: () => false });
    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe(launcher.NOT_FOUND);
    expect(launcher.NOT_FOUND).not.toMatch(/Set its folder|below/);
  });

  test('two presses together, the tray\'s Open OBS and the Stream Deck\'s Record, share one start: one tasklist, one OBS', async () => {
    const p = press({ enabled: true, delayMs: 60 });
    const starter = launcher.createStarter(p.deps);
    const [a, b, c] = await Promise.all([starter.startIfClosed(), starter.startIfClosed(), starter.startIfClosed()]);
    expect(p.spawned).toHaveLength(1);
    expect(p.asked).toHaveLength(1);
    expect(a).toEqual({ ok: true, pid: 77 });
    expect(b).toBe(a);
    expect(c).toBe(a);
    // The press after that asks again (OBS may have been closed since).
    await starter.startIfClosed();
    expect(p.asked).toHaveLength(2);
  });

  test('a start that throws is an answer, not a rejection', async () => {
    const p = press();
    const starter = launcher.createStarter({ ...p.deps, exists: () => { throw new Error('disk'); } });
    expect(await starter.startIfClosed()).toMatchObject({ ok: false });
  });
});

test.describe("Racing Desk's own start: never from the relaunch a key in the car makes, never while he is in the car", () => {
  test('the decision, by what is known', () => {
    const base = { enabled: true, relaunched: false, answered: true, inCar: false };
    expect(launcher.startWithApp(base)).toMatchObject({ start: true });
    expect(launcher.startWithApp({ ...base, enabled: false })).toMatchObject({ start: false, wait: false });
    // The relaunch of Ctrl+Shift+G, which is a key held only in the car: a new instance whose telemetry may say anything.
    expect(launcher.startWithApp({ ...base, relaunched: true })).toMatchObject({ start: false, wait: false });
    expect(launcher.startWithApp({ ...base, relaunched: true, answered: false, inCar: false })).toMatchObject({ start: false, wait: false });
    // No answer from the telemetry yet (a host just started answers late) says nothing about the car: wait.
    expect(launcher.startWithApp({ ...base, answered: false })).toMatchObject({ start: false, wait: true });
    // In the car: not now, and not later by waiting.
    expect(launcher.startWithApp({ ...base, inCar: true })).toMatchObject({ start: false, wait: false });
  });
});

test.describe('Set up OBS, whichever way OBS stands', () => {
  const folder = () => path.join(root, 'Recordings');
  const closedClient = (over = {}) => ({ identified: () => false, state: () => ({ authFailed: false, passwordMissing: false, ...over }), request: async () => { throw new Error('not connected'); } });
  const filesOf = () => {
    const { configJson, profilesDir } = launcher.obsPaths(appData);
    return [fs.readFileSync(configJson, 'utf8'), fs.readFileSync(path.join(profilesDir, 'Untitled', 'basic.ini'), 'utf8'), fs.readFileSync(encoderFile(), 'utf8'), fs.readdirSync(path.join(profilesDir, 'Untitled')).sort()];
  };
  const setup = (client, exec) => launcher.setupObs({ client, exec, appData, folder: folder(), ...f });

  test('a tasklist that cannot say leaves OBS\'s files exactly as they were', async () => {
    const before = filesOf();
    const result = await setup(closedClient(), async () => { throw new Error('tasklist timed out'); });
    expect(result.ok).toBe(false);
    expect(result.did).toEqual([]);
    expect(result.problems).toEqual(["Racing Desk could not tell whether OBS is open. OBS's files were left as they are."]);
    expect(filesOf()).toEqual(before);
    expect(fs.existsSync(folder())).toBe(false);
  });

  test('OBS open and not answering: the files are left, and the sentence is about what is wrong', async () => {
    const before = filesOf();
    const open = async () => ({ stdout: '"obs64.exe","1","Console","1","1 K"\r\n' });
    expect((await setup(closedClient(), open)).problems[0]).toBe('OBS is open with its WebSocket switched off. Quit OBS, then press Set up OBS again.');
    expect((await setup(closedClient({ authFailed: true }), open)).problems[0]).toMatch(/^OBS refused the password\./);
    expect((await setup(closedClient({ passwordMissing: true }), open)).problems[0]).toMatch(/^OBS wants a password and Racing Desk has none\./);
    expect(filesOf()).toEqual(before);
  });

  test('OBS closed: the files are written, and the password comes back for memory and nowhere else', async () => {
    const closed = async () => ({ stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' });
    const result = await setup(closedClient(), closed);
    expect(result).toMatchObject({ ok: true, ran: 'closed', password: 'sixteen-chars-pw' });
    expect(JSON.parse(filesOf()[0]).server_enabled).toBe(true);
    expect(JSON.parse(filesOf()[2])).toMatchObject({ rate_control: 'CQVBR', target_quality: 16, max_bitrate: 100000 });
    for (const s of [...result.did, ...result.problems]) expect(s).not.toContain('sixteen-chars-pw');
  });

  test('OBS open and answering: the profile keys go over the WebSocket, the encoder file is left as it is, and one sentence says the size change waits for a run with OBS closed', async () => {
    const before = filesOf();
    const profile = { AdvOut: { RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: '20', RecFilePath: folder().split(path.sep).join('/') }, SimpleOutput: {} };
    const client = {
      identified: () => true, state: () => ({}),
      async request(type, data) {
        if (type === 'GetProfileParameter') return { parameterValue: profile.AdvOut[data.parameterName] ?? null };
        if (type === 'SetProfileParameter') { profile[data.parameterCategory][data.parameterName] = data.parameterValue; return {}; }
        throw new Error('unexpected ' + type);
      },
    };
    const result = await setup(client, async () => { throw new Error('tasklist is not asked while OBS answers'); });
    expect(result).toMatchObject({ ok: true, ran: 'open' });
    expect(result.did).toEqual([
      `The profile already records Hybrid MP4 with a replay buffer into ${folder()}.`,
      'The size change (full size with a quality target instead of a fixed 100 Mbps) happens the next time Set up OBS runs with OBS closed.',
    ]);
    expect(filesOf().slice(2)).toEqual(before.slice(2));   // the encoder file and the profile folder: nothing written, no copy made
    // Once the quality target is in the file, nothing is said of size.
    fs.writeFileSync(encoderFile(), '{"rate_control":"CQVBR","bitrate":100000,"preset":"p2","target_quality":16,"max_bitrate":100000}');
    expect((await setup(client, async () => { throw new Error('no'); })).did).toEqual([`The profile already records Hybrid MP4 with a replay buffer into ${folder()}.`]);
  });
});

test.describe("the recording encoder's file (recordEncoder.json)", () => {
  test('is read as the plugin reads it: the rate control, the quality level, the cap it has or would get', () => {
    const read = launcher.readEncoderFile(encoderFile(), { readFile: f.readFile });
    expect(read).toEqual({ state: 'ok', json: { rate_control: 'CBR', bitrate: 100000, preset: 'p2' }, text: ENCODER_JSON });
    expect(launcher.encoderCheck(read.json)).toEqual({ rateControl: 'CBR', targetQuality: null, maxBitrate: null, bitrate: 100000, capKbps: 100000, qualityTarget: false });
    // The cap is what the file names today: a VBR's own cap, else the CBR bitrate, else 100 Mbps.
    expect(launcher.encoderCheck({ rate_control: 'VBR', bitrate: 40000, max_bitrate: 60000 }).capKbps).toBe(60000);
    expect(launcher.encoderCheck({ rate_control: 'CBR', bitrate: 40000 }).capKbps).toBe(40000);
    expect(launcher.encoderCheck({}).capKbps).toBe(100000);
    expect(launcher.encoderCheck(null).capKbps).toBe(100000);
    expect(launcher.encoderWanted(read.json)).toEqual({ rate_control: 'CQVBR', target_quality: 16, max_bitrate: 100000 });
    // A quality target with a cap is one, whatever its numbers (one he tuned is his), as the plugin compares the mode: without case.
    expect(launcher.encoderCheck({ rate_control: 'cqvbr', target_quality: 20, max_bitrate: 80000 })).toMatchObject({ qualityTarget: true, capKbps: 80000 });
    expect(launcher.encoderCheck({ rate_control: 'CQVBR', target_quality: 16 })).toMatchObject({ qualityTarget: false });   // no cap: not what Set up OBS makes
    expect(launcher.encoderCheck({ rate_control: 'CQP', cqp: 18 })).toMatchObject({ qualityTarget: false, capKbps: 100000 });
    expect(launcher.readEncoderFile(path.join(root, 'nowhere.json'), { readFile: f.readFile })).toEqual({ state: 'missing', json: null, text: null });
    fs.writeFileSync(encoderFile(), '{not json');
    expect(launcher.readEncoderFile(encoderFile(), { readFile: f.readFile }).state).toBe('unreadable');
    fs.writeFileSync(encoderFile(), '[1,2]');
    expect(launcher.readEncoderFile(encoderFile(), { readFile: f.readFile }).state).toBe('unreadable');
  });

  test('the quality target is written atomically, changing only the three rate-control keys; every other key, known to OBS or not, is kept in its place', () => {
    fs.writeFileSync(encoderFile(), '{"rate_control":"CBR","bitrate":100000,"preset":"p2","keyint_sec":2,"bf":2,"lookahead":true,"frobnicate":"yes","opts":"lookaheadDepth=16"}');
    const result = launcher.setEncoderQuality(encoderFile(), f);
    expect(result).toMatchObject({ changed: true, state: 'ok', kept: true, before: { qualityTarget: false, capKbps: 100000 }, after: { qualityTarget: true, rateControl: 'CQVBR', targetQuality: 16, maxBitrate: 100000 } });
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe('{"rate_control":"CQVBR","bitrate":100000,"preset":"p2","keyint_sec":2,"bf":2,"lookahead":true,"frobnicate":"yes","opts":"lookaheadDepth=16","target_quality":16,"max_bitrate":100000}');
    // A temp file beside it and a rename: a write cut short leaves the old file.
    const tmp = `${encoderFile()}.racing-desk.tmp`;
    expect(f.touched).toContain(tmp);
    expect(f.touched.indexOf(tmp)).toBeLessThan(f.touched.lastIndexOf(encoderFile()));
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('the file as it was is kept beside it the first time and never written over after; a quality target already there changes nothing', () => {
    const keep = `${encoderFile()}.before-racing-desk`;
    expect(launcher.setEncoderQuality(encoderFile(), f)).toMatchObject({ changed: true, kept: true });
    expect(fs.readFileSync(keep, 'utf8')).toBe(ENCODER_JSON);
    // Already set: nothing written, nothing kept.
    const asSet = fs.readFileSync(encoderFile(), 'utf8');
    expect(launcher.setEncoderQuality(encoderFile(), f)).toMatchObject({ changed: false, state: 'ok', kept: false });
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe(asSet);
    // He goes back to CBR in OBS, then presses Set up OBS again: the copy still says what he had before Racing Desk ever wrote the file.
    fs.writeFileSync(encoderFile(), '{"rate_control":"CBR","bitrate":50000,"preset":"p4"}');
    expect(launcher.setEncoderQuality(encoderFile(), f)).toMatchObject({ changed: true, kept: false, after: { maxBitrate: 50000 } });
    expect(fs.readFileSync(keep, 'utf8')).toBe(ENCODER_JSON);
    // A target he tuned himself is his.
    fs.writeFileSync(encoderFile(), '{"rate_control":"CQVBR","target_quality":22,"max_bitrate":60000,"preset":"p6"}');
    expect(launcher.setEncoderQuality(encoderFile(), f)).toMatchObject({ changed: false });
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe('{"rate_control":"CQVBR","target_quality":22,"max_bitrate":60000,"preset":"p6"}');
  });

  test('a missing file is made with the three keys and no copy; an unreadable one is left as it is and said so', () => {
    fs.unlinkSync(encoderFile());
    expect(launcher.setEncoderQuality(encoderFile(), f)).toMatchObject({ changed: true, state: 'missing', kept: false });
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe('{"rate_control":"CQVBR","target_quality":16,"max_bitrate":100000}');
    expect(fs.existsSync(`${encoderFile()}.before-racing-desk`)).toBe(false);
    fs.writeFileSync(encoderFile(), '{"rate_control":');
    const result = launcher.setEncoderQuality(encoderFile(), f);
    expect(result).toMatchObject({ changed: false, state: 'unreadable' });
    expect(result.reason).toBe("The profile's encoder settings file could not be read, so the recordings' size was left as it is.");
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe('{"rate_control":');
  });

  test('which profiles the keys mean something to: Advanced output, a Standard recording, an NVENC encoder of its own', () => {
    expect(launcher.profileEncoder(BASIC_INI)).toEqual({ id: 'obs_nvenc_h264_tex', advanced: true, standard: true, sameAsStream: false, nvenc: true, applies: true });
    for (const id of ['obs_nvenc_hevc_tex', 'obs_nvenc_av1_tex', 'jim_nvenc', 'ffmpeg_nvenc']) {
      expect(launcher.profileEncoder(BASIC_INI.replace('RecEncoder=obs_nvenc_h264_tex', `RecEncoder=${id}`)).applies).toBe(true);
    }
    expect(launcher.profileEncoder(BASIC_INI.replace('RecEncoder=obs_nvenc_h264_tex', 'RecEncoder=obs_x264'))).toMatchObject({ id: 'obs_x264', nvenc: false, applies: false });
    expect(launcher.profileEncoder(BASIC_INI.replace('RecEncoder=obs_nvenc_h264_tex', 'RecEncoder=none'))).toMatchObject({ sameAsStream: true, applies: false });
    expect(launcher.profileEncoder(BASIC_INI.replace('Mode=Advanced', 'Mode=Simple'))).toMatchObject({ advanced: false, applies: false });
    expect(launcher.profileEncoder(BASIC_INI.replace('RecType=Standard', 'RecType=FFmpeg'))).toMatchObject({ standard: false, applies: false });
    expect(launcher.profileEncoder(BASIC_INI.replace('RecType=Standard\n', ''))).toMatchObject({ standard: true, applies: true });   // OBS's default
  });

  test('Set up OBS while closed leaves a profile that records with x264 alone and says so; the status for the card says what applies', () => {
    const { profilesDir } = launcher.obsPaths(appData);
    const ini = path.join(profilesDir, 'Untitled', 'basic.ini');
    fs.writeFileSync(ini, BASIC_INI.replace('RecEncoder=obs_nvenc_h264_tex', 'RecEncoder=obs_x264'));
    const result = launcher.setupWhileClosed({ appData, folder: path.join(root, 'R'), ...f });
    expect(result.problems).toEqual([]);
    expect(result.did).toContain("The recordings' size was left as it is: the profile records with obs_x264, not NVENC.");
    expect(fs.readFileSync(encoderFile(), 'utf8')).toBe(ENCODER_JSON);
    expect(launcher.encoderStatus({ appData, readFile: f.readFile })).toMatchObject({ applies: false, encoder: 'obs_x264', qualityTarget: null, capKbps: null });
    // Simple output: nothing applies, and nothing is said.
    fs.writeFileSync(ini, BASIC_INI.replace('Mode=Advanced', 'Mode=Simple'));
    expect(launcher.setupWhileClosed({ appData, folder: path.join(root, 'R'), ...f }).did.some((s) => /size/.test(s))).toBe(false);
    // His: NVENC, not set up yet, the cap being his 100 Mbps.
    fs.writeFileSync(ini, BASIC_INI);
    expect(launcher.encoderStatus({ appData, readFile: f.readFile })).toEqual({ applies: true, encoder: 'obs_nvenc_h264_tex', state: 'ok', profile: 'Untitled', file: encoderFile(), qualityTarget: false, capKbps: 100000, bitrateKbps: 100000 });
    launcher.setupWhileClosed({ appData, folder: path.join(root, 'R'), ...f });
    expect(launcher.encoderStatus({ appData, readFile: f.readFile })).toMatchObject({ applies: true, qualityTarget: true, capKbps: 100000 });
    // No profile at all: nothing applies.
    expect(launcher.encoderStatus({ appData: path.join(root, 'nope'), readFile: (p) => fs.readFileSync(p) })).toMatchObject({ applies: false, qualityTarget: null });
  });
});

test('the folder the current profile records into, from its basic.ini: Advanced or Simple output', () => {
  expect(launcher.profileRecordFolder({ appData, readFile: f.readFile })).toBe('C:/Users/Driver/Videos/NVIDIA');
  const { profilesDir } = launcher.obsPaths(appData);
  const ini = path.join(profilesDir, 'Untitled', 'basic.ini');
  fs.writeFileSync(ini, fs.readFileSync(ini, 'utf8').replace('Mode=Advanced', 'Mode=Simple'));
  expect(launcher.profileRecordFolder({ appData, readFile: f.readFile })).toBe('C:\\Users\\Driver\\Videos');
  expect(launcher.profileRecordFolder({ appData: path.join(root, 'nope'), readFile: (p) => fs.readFileSync(p) })).toBeNull();
});
