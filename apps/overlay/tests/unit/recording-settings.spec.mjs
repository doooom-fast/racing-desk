/**
 * The recording keys of overlay-settings.json, brought from the Electron recorder's days to OBS's
 * (modules/js/recording-settings.js). The key set is his file's as it stood on 2026-09-30; the values are made up.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const rs = require('../../modules/js/recording-settings.js');
const settingsFile = require('../../modules/js/settings-file.js');

// His key set (values made up), with the HUD's own keys beside them, which must come through untouched.
const HIS = {
  zoom: 165, showSpotter: false, simhubUrl: 'http://localhost:8889/racing-desk/', paints: { paintDir: 'X:\\paint', customerId: '424242' },
  remoteServer: true, remoteServerKey: 'abcd2345',
  recordingQuality: 'ultra', recordingMic: false, recordingMicDevice: 'dev-1', recordingMicLabel: 'Mic', recordingMicVolume: 0.8,
  recordingSystemAudioDevice: 'dev-2', recordingSystemAudioLabel: 'Cable', recordingSystemVolume: 1,
  recordingWebcamDevice: 'dev-3', recordingWebcamLabel: 'Cam', recordingFacecamSize: 'medium', recordingFacecamPos: 'bottom-right',
  recordingOutputFormat: 'mp4', recordingEncoder: 'auto', recordingDeleteSource: true,
  recordingAutoRecord: true, recordingAutoStopOnPit: false,
  replayBufferEnabled: false, replayBufferSeconds: 30, replayBufferDuration: 30,
  recordingBackend: 'native', hostControlPort: 50965,
  greenScreen: false,
};

test.describe('the migration', () => {
  test('deletes the Electron recorder\'s keys and the dead control server, renames the two that keep a meaning, adds the OBS ones', () => {
    const { settings, changed, removed, renamed, added } = rs.migrate(HIS);
    expect(changed).toBe(true);
    for (const key of ['recordingBackend', 'hostControlPort', 'recordingQuality', 'recordingEncoder', 'recordingOutputFormat', 'recordingDeleteSource',
      'recordingMic', 'recordingMicDevice', 'recordingMicLabel', 'recordingMicVolume', 'recordingSystemAudioDevice', 'recordingSystemAudioLabel',
      'recordingSystemVolume', 'recordingWebcamDevice', 'recordingWebcamLabel', 'recordingFacecamSize', 'recordingFacecamPos',
      'replayBufferSeconds', 'replayBufferDuration', 'replayBufferEnabled', 'recordingDirectory', 'recordingAutoStopOnPit']) {
      expect(key in settings, key).toBe(false);
    }
    expect(removed).toContain('recordingBackend');
    expect(removed).toContain('hostControlPort');
    // Kept as it is.
    expect(settings.recordingAutoRecord).toBe(true);
    // "Stop in the pits" went with his rules of 2026-09-30 (stage 2).
    expect(removed).toContain('recordingAutoStopOnPit');
    // Renamed.
    expect(settings.recordingInstantReplay).toBe(false);
    expect(renamed).toEqual([['replayBufferEnabled', 'recordingInstantReplay']]);
    // Added.
    expect(settings.recordingInstantReplaySeconds).toBe(20);
    expect(settings.recordingChapters).toBe(true);
    expect(settings.obsStartOnRecord).toBe(true);
    expect(settings.obsStartWithApp).toBe(false);
    expect(settings.obsPath).toBeNull();
    expect(settings.obsHudSource).toBe(false);
    expect(settings.localServerPort).toBe(9091);
    expect(settings.tvShotsHideFacecam).toBe(true);
    // Version 5: what OBS draws under "HUD drawn by OBS" and the panel background for it; the green-screen key nothing read is gone.
    expect(settings.obsHudView).toBe('rig');
    expect(settings.obsPanelBackground).toBe(90);
    expect('greenScreen' in settings).toBe(false);
    expect(removed).toContain('greenScreen');
    expect(added.sort()).toEqual(['localServerPort', 'obsHudSource', 'obsHudView', 'obsPanelBackground', 'obsPath', 'obsStartOnRecord', 'obsStartWithApp', 'recordingChapters', 'recordingInstantReplaySeconds', 'tvShotsHideFacecam']);
    expect(settings.recordingSettingsVersion).toBe(5);
    // The HUD's own keys, the paints and the iPad's are untouched.
    expect(settings.zoom).toBe(165);
    expect(settings.showSpotter).toBe(false);
    expect(settings.paints).toEqual(HIS.paints);
    expect(settings.remoteServerKey).toBe('abcd2345');
    // And the object given is left as it was.
    expect(HIS.recordingBackend).toBe('native');
  });

  test('a folder he had set is kept under its new name; an empty one is not', () => {
    expect(rs.migrate({ recordingDirectory: 'E:\\Clips ' }).settings.recordingFolder).toBe('E:\\Clips');
    const empty = rs.migrate({ recordingDirectory: '' }).settings;
    expect('recordingFolder' in empty).toBe(false);
    expect('recordingDirectory' in empty).toBe(false);
    // A switch that is not a boolean is not carried over as one.
    expect('recordingInstantReplay' in rs.migrate({ replayBufferEnabled: 'yes' }).settings).toBe(false);
    expect(rs.migrate({ replayBufferEnabled: true }).settings.recordingInstantReplay).toBe(true);
    // A new key already present (a later build wrote it) is not written over.
    expect(rs.migrate({ obsStartOnRecord: false, replayBufferEnabled: true, recordingInstantReplay: true }).settings.obsStartOnRecord).toBe(false);
  });

  test('is idempotent: a second run changes nothing, and so does a file that is already at the version', () => {
    const first = rs.migrate(HIS);
    const second = rs.migrate(first.settings);
    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first.settings);
    expect(rs.migrate({ recordingSettingsVersion: 5, recordingBackend: 'native' }).changed).toBe(false);
    expect(rs.migrate({ recordingSettingsVersion: 6 }).changed).toBe(false);
    // A file at version 2 (stage 1) loses "stop in the pits" and nothing else, and comes to 5.
    const fromTwo = rs.migrate({ recordingSettingsVersion: 2, recordingAutoRecord: true, recordingAutoStopOnPit: true, recordingInstantReplay: false, obsStartOnRecord: false, zoom: 120 });
    expect(fromTwo.changed).toBe(true);
    expect(fromTwo.removed).toEqual(['recordingAutoStopOnPit']);
    expect(fromTwo.renamed).toEqual([]);
    expect(fromTwo.added.sort()).toEqual(['localServerPort', 'obsHudSource', 'obsHudView', 'obsPanelBackground', 'obsPath', 'obsStartWithApp', 'recordingChapters', 'recordingInstantReplaySeconds', 'tvShotsHideFacecam']);
    expect(fromTwo.settings).toMatchObject({ recordingSettingsVersion: 5, recordingAutoRecord: true, recordingInstantReplay: false, obsStartOnRecord: false, zoom: 120 });
    // A file at version 3 (stage 2) gets the loopback listener's port and the TV shots' switch, and version 5's two keys.
    const fromThree = rs.migrate({ recordingSettingsVersion: 3, obsHudSource: true, recordingChapters: false, zoom: 120, recordingInstantReplaySeconds: 20, obsStartOnRecord: true, obsStartWithApp: false, obsPath: null });
    expect(fromThree.changed).toBe(true);
    expect(fromThree.removed).toEqual([]);
    expect(fromThree.added.sort()).toEqual(['localServerPort', 'obsHudView', 'obsPanelBackground', 'tvShotsHideFacecam']);
    expect(fromThree.settings).toMatchObject({ recordingSettingsVersion: 5, obsHudSource: true, recordingChapters: false, zoom: 120, localServerPort: 9091, tvShotsHideFacecam: true });
    // A file at version 4 (stage 3) gets the choice, Rig HUD, and the OBS slider at the panels' nine-tenths; loses the
    // green-screen key; and nothing else changes.
    const four = { recordingSettingsVersion: 4, recordingInstantReplaySeconds: 20, recordingChapters: true, obsStartOnRecord: true, obsStartWithApp: false, obsPath: null, obsHudSource: true, greenScreen: true, localServerPort: 9092, tvShotsHideFacecam: false, zoom: 120 };
    const fromFour = rs.migrate(four);
    expect(fromFour.changed).toBe(true);
    expect(fromFour.removed).toEqual(['greenScreen']);
    expect(fromFour.added.sort()).toEqual(['obsHudView', 'obsPanelBackground']);
    const { greenScreen, ...kept } = four;
    expect(fromFour.settings).toEqual({ ...kept, recordingSettingsVersion: 5, obsHudView: 'rig', obsPanelBackground: 90 });
    // A choice or a slider already in the file (a later build wrote it) is not written over.
    expect(rs.migrate({ recordingSettingsVersion: 4, obsHudView: 'ipad', obsPanelBackground: 40 }).settings).toMatchObject({ obsHudView: 'ipad', obsPanelBackground: 40 });
  });

  test('the choice of what OBS draws is read strictly: ipad when the file says so, the rig HUD for anything else', () => {
    expect(rs.HUD_VIEWS).toEqual(['rig', 'ipad']);
    expect(rs.hudViewOf({ obsHudView: 'ipad' })).toBe('ipad');
    for (const value of ['rig', 'iPad', 'IPAD', 'television', '', null, undefined, 1, true]) expect(rs.hudViewOf({ obsHudView: value }), String(value)).toBe('rig');
    expect(rs.hudViewOf(null)).toBe('rig');
    expect(rs.hudViewOf({})).toBe('rig');
  });

  test('a missing or empty file gets the OBS keys and the version, and nothing else', () => {
    for (const file of [null, undefined, {}, [], 'x']) {
      const { settings, changed } = rs.migrate(file);
      expect(changed).toBe(true);
      expect(Object.keys(settings).sort()).toEqual(['localServerPort', 'obsHudSource', 'obsHudView', 'obsPanelBackground', 'obsPath', 'obsStartOnRecord', 'obsStartWithApp', 'recordingChapters', 'recordingInstantReplaySeconds', 'recordingSettingsVersion', 'tvShotsHideFacecam']);
    }
  });
});

test.describe('the file', () => {
  let dir;
  test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-recording-settings-')); });
  test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('is migrated in place, through settings-file.js, once', () => {
    const file = path.join(dir, 'overlay-settings.json');
    fs.writeFileSync(file, JSON.stringify(HIS, null, 2));
    const result = rs.migrateFile(file, { settingsFile });
    expect(result.state).toBe('ok');
    expect(result.changed).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect('recordingBackend' in onDisk).toBe(false);
    expect('hostControlPort' in onDisk).toBe(false);
    expect('greenScreen' in onDisk).toBe(false);
    expect(onDisk.recordingSettingsVersion).toBe(5);
    expect(onDisk.remoteServerKey).toBe('abcd2345');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    const mtime = fs.statSync(file).mtimeMs;
    const again = rs.migrateFile(file, { settingsFile });
    expect(again.changed).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  test('a file that is not there is made with the OBS keys; one that cannot be read is left as it is', () => {
    const missing = path.join(dir, 'overlay-settings.json');
    const made = rs.migrateFile(missing, { settingsFile });
    expect(made.state).toBe('missing');
    expect(JSON.parse(fs.readFileSync(missing, 'utf8')).recordingSettingsVersion).toBe(5);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    const left = rs.migrateFile(broken, { settingsFile });
    expect(left.state).toBe('unreadable');
    expect(left.changed).toBe(false);
    expect(fs.readFileSync(broken, 'utf8')).toBe('{ not json');
  });
});

test.describe('the folder', () => {
  test('is the one he set, else D:\\Racing Desk\\Recordings while there is a D: drive, else Racing Desk in his Videos', () => {
    const onD = { exists: (p) => p === 'D:\\', home: 'C:\\Users\\Driver' };
    const noD = { exists: () => false, home: 'C:\\Users\\Driver' };
    expect(rs.recordingFolder({ recordingFolder: ' E:\\Clips ' }, onD)).toBe('E:\\Clips');
    expect(rs.recordingFolder({}, onD)).toBe('D:\\Racing Desk\\Recordings');
    expect(rs.recordingFolder({ recordingFolder: '' }, onD)).toBe('D:\\Racing Desk\\Recordings');
    expect(rs.recordingFolder(null, noD)).toBe(path.join('C:\\Users\\Driver', 'Videos', 'Racing Desk'));
  });
});
