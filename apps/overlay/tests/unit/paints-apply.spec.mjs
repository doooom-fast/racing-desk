/**
 * Apply, backup, cooked-file cleanup and revert, in a temp paint folder and a temp backups base — never the real
 * Documents\iRacing\paint or %LOCALAPPDATA%. The process and downloader checks are faked quiet. Port of the tests
 * in apps/paints/src-tauri/src/apply.rs plus: the preflight guards, the "never delete what the app did not
 * install" rules, and the apply → identify → revert → identify round trip.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const apply = require('../../modules/js/paints/apply.js');
const digest = require('../../modules/js/paints/digest.js');
const installed = require('../../modules/js/paints/installed.js');

const CUSTOMER = '424242';
const STRANGER = '999000';

const quietSim = async () => ({ simRunning: false, uiRunning: false, matched: [] });
const quietTp = async () => ({
  configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null,
  deleteBeforeDownloading: null, deleteAfterSession: null, keepSynced: null, warnings: [],
});
const quiet = { simState: quietSim, tradingPaints: quietTp };

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-apply-')); });
test.afterAll(() => {
  // Some tests leave files read-only; clear before removing.
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { fs.chmodSync(p, 0o666); } catch (e2) { /* fine */ } }
    }
  };
  walk(root);
  fs.rmSync(root, { recursive: true, force: true });
});

// paint/lotus79, library/lotus79/<version>, backups — all under one temp folder.
function fixture(tag) {
  const base = path.join(root, tag);
  const paint = path.join(base, 'paint');
  const library = path.join(base, 'library');
  const backups = path.join(base, 'backups');   // aimed at a temp dir, never the real app data directory
  fs.mkdirSync(path.join(paint, 'lotus79'), { recursive: true });
  fs.mkdirSync(path.join(library, 'lotus79'), { recursive: true });
  return { base, paint, library, backups, car: path.join(paint, 'lotus79') };
}

function makeVersion(fx, id, paintBytes, specBytes) {
  const dir = path.join(fx.library, 'lotus79', id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const p = path.join(dir, `car_${CUSTOMER}.tga`);
  fs.writeFileSync(p, paintBytes);
  files.push({ role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: p, size: paintBytes.length, sha256: digest.fileSha256(p) });
  if (specBytes != null) {
    const s = path.join(dir, `car_spec_${CUSTOMER}.tga`);
    fs.writeFileSync(s, specBytes);
    files.push({ role: 'car_spec', roleLabel: 'Spec map', fileName: `car_spec_${CUSTOMER}.tga`, path: s, size: specBytes.length, sha256: digest.fileSha256(s) });
  }
  return {
    id, name: id, path: dir, files, previews: [], meta: {}, hasPaint: true, hasSpec: specBytes != null, problems: [],
  };
}

function request(fx, extra = {}) {
  return {
    paintDir: fx.paint,
    libraryRoot: fx.library,
    carFolder: 'lotus79',
    simFolder: 'lotus79',
    versionId: 'v13',
    customerId: CUSTOMER,
    includeSpec: true,
    setReadOnlyAfter: false,
    clearOtherCooked: false,
    force: false,
    ...extra,
  };
}

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const isReadOnly = (p) => (fs.statSync(p).mode & 0o222) === 0;

test.describe('preflight', () => {
  test('a quiet machine with the car folder present has nothing to say', async () => {
    const fx = fixture('pre-quiet');
    expect(await apply.preflight(fx.paint, 'lotus79', quiet)).toEqual({ blockers: [], warnings: [] });
  });

  test('the sim running blocks; the launcher alone only warns', async () => {
    const fx = fixture('pre-sim');
    const sim = await apply.preflight(fx.paint, 'lotus79', { ...quiet, simState: async () => ({ simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe', 'iRacingUI.exe'] }) });
    expect(sim.blockers).toEqual(['iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.']);
    expect(sim.warnings).toEqual([]);
    const ui = await apply.preflight(fx.paint, 'lotus79', { ...quiet, simState: async () => ({ simRunning: false, uiRunning: true, matched: ['iRacingUI.exe'] }) });
    expect(ui.blockers).toEqual([]);
    expect(ui.warnings).toEqual(['The iRacing launcher is open. That is harmless now, but starting a session will lock these files.']);
  });

  test('Trading Paints warnings block while the downloader runs, and only warn when it does not', async () => {
    const fx = fixture('pre-tp');
    const tp = (running) => async () => ({ ...(await quietTp()), running, warnings: ['TP says no.'] });
    expect(await apply.preflight(fx.paint, 'lotus79', { ...quiet, tradingPaints: tp(true) })).toEqual({ blockers: ['TP says no.'], warnings: [] });
    expect(await apply.preflight(fx.paint, 'lotus79', { ...quiet, tradingPaints: tp(false) })).toEqual({ blockers: [], warnings: ['TP says no.'] });
  });

  test('a car the sim has never created has nowhere to install into', async () => {
    const fx = fixture('pre-nocar');
    const pre = await apply.preflight(fx.paint, 'nissangtpzxt', quiet);
    expect(pre.blockers).toEqual(['There is no nissangtpzxt folder in the paint directory. The sim creates it the first time you drive the car.']);
  });
});

test.describe('backupsBase', () => {
  test('lives under %LOCALAPPDATA%\\Racing Desk\\paints\\backups, never in the library', () => {
    expect(apply.backupsBase({ env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' } }))
      .toBe(path.join('C:\\Users\\x\\AppData\\Local', 'Racing Desk', 'paints', 'backups'));
    expect(apply.backupsBase({ env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' } }))
      .toBe(path.join('C:\\Users\\x\\AppData\\Roaming', 'Racing Desk', 'paints', 'backups'));
    expect(apply.backupsBase({ env: { HOME: '/home/x' } })).toBe(path.join('/home/x', '.local', 'share', 'Racing Desk', 'paints', 'backups'));
    expect(() => apply.backupsBase({ env: {} })).toThrow('Nowhere to store backups on this machine.');
    expect(() => apply.backupsBase({ env: { LOCALAPPDATA: '' } })).toThrow('Nowhere to store backups on this machine.');
  });

  test('timestamps are fixed width to the millisecond, and the manifest time carries its offset', () => {
    const d = new Date(2026, 8, 27, 9, 5, 3, 7);
    expect(apply.timestamp(d)).toBe('2026-09-27_090503_007');
    expect(apply.rfc3339Local(d)).toMatch(/^2026-09-27T09:05:03\.007[+-]\d\d:\d\d$/);
  });
});

test.describe('apply', () => {
  test('applies, renames for the customer and backs up what was there, with a manifest', async () => {
    const fx = fixture('basic');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'OLD PAINT');
    fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.tga`), 'NOT MINE');

    const version = makeVersion(fx, 'v13', 'NEW PAINT', 'NEW SPEC');
    const report = await apply.apply(request(fx), version, fx.backups, quiet);
    expect(report.applied).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(Object.keys(report).sort()).toEqual(['actions', 'applied', 'backupDir', 'helmet', 'warnings']);
    // A library that keeps no helmets leaves the car's alone, and says so.
    expect(report.helmet).toEqual({ set: null, onCar: false, isDefault: false, said: 'The library keeps no helmets, so the helmet on the car was left as it was.' });
    expect(exists(path.join(fx.car, `helmet_${CUSTOMER}.tga`))).toBe(false);
    expect(exists(path.join(fx.paint, `helmet_${CUSTOMER}.tga`))).toBe(false);

    // Installed under the customer id, both roles.
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('NEW PAINT');
    expect(read(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe('NEW SPEC');
    // Another driver's paint is not the app's to touch.
    expect(read(path.join(fx.car, `car_${STRANGER}.tga`))).toBe('NOT MINE');

    // The old paint survived, in the backup, under the backups base, with a manifest of exactly that file.
    const backup = report.backupDir;
    expect(backup.startsWith(path.join(fx.backups, 'lotus79'))).toBe(true);
    expect(read(path.join(backup, `car_${CUSTOMER}.tga`))).toBe('OLD PAINT');
    expect(exists(path.join(backup, `car_${STRANGER}.tga`))).toBe(false);
    const manifest = JSON.parse(read(path.join(backup, 'manifest.json')));
    expect(manifest).toMatchObject({ carFolder: 'lotus79', simFolder: 'lotus79', customerId: CUSTOMER, reason: 'apply v13' });
    expect(manifest.files).toEqual([{ fileName: `car_${CUSTOMER}.tga`, size: 9, sha256: digest.fileSha256(path.join(backup, `car_${CUSTOMER}.tga`)) }]);
    expect(manifest.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);

    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'install', 'install', 'cooked']);
    expect(report.actions[0].detail).toBe(`1 file backed up to ${backup}`);
    expect(report.actions[1].detail).toBe(`car_${CUSTOMER}.tga -> car_${CUSTOMER}.tga`);
    expect(report.actions[3].detail).toBe('0 cooked .mip files deleted so the sim re-cooks');
  });

  test('deletes only this customer\'s cooked files, and backs them up first', async () => {
    // The folder is full of other drivers' cooked textures; clearing them all would cost everyone a re-cook.
    const fx = fixture('mips');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.mip`), 'mine');
    fs.writeFileSync(path.join(fx.car, `car_spec_${CUSTOMER}.mip`), 'mine too');
    fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.mip`), 'someone else');
    fs.writeFileSync(path.join(fx.car, 'car_777.mip'), 'someone else again');

    const version = makeVersion(fx, 'v13', 'NEW', null);
    const report = await apply.apply(request(fx), version, fx.backups, quiet);

    expect(exists(path.join(fx.car, `car_${CUSTOMER}.mip`))).toBe(false);
    expect(exists(path.join(fx.car, `car_spec_${CUSTOMER}.mip`))).toBe(false);
    expect(exists(path.join(fx.car, `car_${STRANGER}.mip`))).toBe(true);   // another driver's cooked file must be left alone
    expect(exists(path.join(fx.car, 'car_777.mip'))).toBe(true);
    // Both cooked files went into the backup, so a revert restores the cache as well as the source.
    expect(read(path.join(report.backupDir, `car_${CUSTOMER}.mip`))).toBe('mine');
    expect(read(path.join(report.backupDir, `car_spec_${CUSTOMER}.mip`))).toBe('mine too');
    const kinds = report.actions.map((a) => a.kind);
    expect(kinds).toEqual(['backup', 'install', 'cooked', 'cooked-kept']);
    expect(report.actions[2].detail).toBe('2 cooked .mip files deleted so the sim re-cooks');
    expect(report.actions[3].detail).toBe('2 cooked file(s) belonging to other drivers left alone');
  });

  test('opting in clears every cooked file', async () => {
    const fx = fixture('mips-all');
    fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.mip`), 'someone else');
    fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.tga`), 'someone else\'s source');
    const version = makeVersion(fx, 'v13', 'NEW', null);
    const report = await apply.apply(request(fx, { clearOtherCooked: true }), version, fx.backups, quiet);
    expect(exists(path.join(fx.car, `car_${STRANGER}.mip`))).toBe(false);
    // Only cooked files: the stranger's .tga is not the app's to delete, opt-in or not.
    expect(exists(path.join(fx.car, `car_${STRANGER}.tga`))).toBe(true);
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'install', 'cooked']);
    expect(report.actions[2].detail).toBe('1 cooked .mip file deleted so the sim re-cooks');
  });

  test('read-only targets are cleared, then written', async () => {
    const fx = fixture('readonly');
    const target = path.join(fx.car, `car_${CUSTOMER}.tga`);
    fs.writeFileSync(target, 'OLD');
    apply.setReadOnly(target);
    expect(isReadOnly(target)).toBe(true);
    const version = makeVersion(fx, 'v13', 'NEW', null);
    await apply.apply(request(fx), version, fx.backups, quiet);
    expect(read(target)).toBe('NEW');
  });

  test('can relock after applying — the trick against Trading Paints — and still write over it next time', async () => {
    const fx = fixture('relock');
    const version = makeVersion(fx, 'v13', 'NEW', 'SPEC');
    const report = await apply.apply(request(fx, { setReadOnlyAfter: true }), version, fx.backups, quiet);
    const target = path.join(fx.car, `car_${CUSTOMER}.tga`);
    expect(isReadOnly(target)).toBe(true);
    expect(isReadOnly(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe(true);
    expect(report.actions.at(-1)).toEqual({ kind: 'read-only', detail: '2 installed file(s) set read-only' });

    // And a later apply must still be able to write over it.
    const version2 = makeVersion(fx, 'v14', 'NEWER', null);
    await apply.apply(request(fx, { versionId: 'v14' }), version2, fx.backups, quiet);
    expect(read(target)).toBe('NEWER');
    expect(isReadOnly(target)).toBe(false);
  });

  test('skipping the spec map warns that the old one remains', async () => {
    const fx = fixture('nospec');
    fs.writeFileSync(path.join(fx.car, `car_spec_${CUSTOMER}.tga`), 'OLD SPEC');
    const version = makeVersion(fx, 'v13', 'NEW', 'NEW SPEC');
    const report = await apply.apply(request(fx, { includeSpec: false }), version, fx.backups, quiet);
    expect(read(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe('OLD SPEC');
    expect(report.warnings).toEqual(['The spec map was not installed. Any spec map already in the folder is still there and will be used with this paint.']);
    expect(report.actions.filter((a) => a.kind === 'install')).toHaveLength(1);
  });

  test('includeSpec defaults on when the request leaves it out, as serde did', async () => {
    const fx = fixture('spec-default');
    const version = makeVersion(fx, 'v13', 'NEW', 'NEW SPEC');
    const req = request(fx);
    delete req.includeSpec;
    await apply.apply(req, version, fx.backups, quiet);
    expect(read(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe('NEW SPEC');
  });

  test('a bad customer id changes nothing', async () => {
    const fx = fixture('badid');
    const version = makeVersion(fx, 'v13', 'NEW', null);
    await expect(apply.apply(request(fx, { customerId: 'not-digits' }), version, fx.backups, quiet))
      .rejects.toThrow('The customer id must be digits only. Nothing was changed.');
    expect(exists(path.join(fx.car, 'car_not-digits.tga'))).toBe(false);
    expect(exists(fx.backups)).toBe(false);
  });

  test('a version with nothing to install is refused', async () => {
    const fx = fixture('nothing');
    const version = makeVersion(fx, 'v13', 'NEW', 'SPEC');
    version.files = version.files.filter((f) => f.role === 'car_spec');
    version.hasPaint = false;
    await expect(apply.apply(request(fx), version, fx.backups, quiet)).rejects.toThrow('This version has no car paint. Nothing was changed.');
    await expect(apply.apply(request(fx, { includeSpec: false }), version, fx.backups, quiet)).rejects.toThrow('This version has no textures to install. Nothing was changed.');
    expect(exists(fx.backups)).toBe(false);
  });

  test('a preflight blocker refuses without force, and is recorded as a warning with it', async () => {
    const fx = fixture('blocked');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'OLD');
    const version = makeVersion(fx, 'v13', 'NEW', null);
    const simOn = { ...quiet, simState: async () => ({ simRunning: true, uiRunning: false, matched: ['iRacingSim64DX11.exe'] }) };

    const err = await apply.apply(request(fx), version, fx.backups, simOn).catch((e) => e);
    expect(err.kind).toBe('refused');
    expect(err.message).toBe('iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.');
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('OLD');
    expect(exists(fx.backups)).toBe(false);

    const report = await apply.apply(request(fx, { force: true }), version, fx.backups, simOn);
    expect(report.applied).toBe(true);
    expect(report.warnings).toEqual(['Applied anyway, over a warning: iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.']);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('NEW');
  });

  test('a missing source file rolls the apply back, and leaves no temp files', async () => {
    const fx = fixture('rollback');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    // Paint is fine, spec points at a file that is not there.
    const version = makeVersion(fx, 'v13', 'NEW PAINT', 'NEW SPEC');
    version.files[1].path = path.join(fx.base, 'gone.tga');

    const err = await apply.apply(request(fx), version, fx.backups, quiet).catch((e) => e);
    expect(err.kind).toBe('refused');
    expect(err.message).toMatch(new RegExp(`^Could not write car_spec_${CUSTOMER}\\.tga \\(.+\\)\\. Everything this apply had changed was put back from `));
    expect(err.message).not.toContain('could not be restored');

    // The paint that was already swapped must be back to what it was.
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    const leftovers = fs.readdirSync(fx.car).filter((n) => n.includes(apply.TMP_EXT));
    expect(leftovers).toEqual([]);
  });

  test('backups never land inside the library', async () => {
    // They used to. The library is usually a git checkout, so every apply left untracked files in the user's
    // repo, and the app's own update check then refused to pull because of them.
    const fx = fixture('outside');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'OLD');
    const version = makeVersion(fx, 'v13', 'NEW', 'SPEC');
    const before = walk(fx.library);
    const report = await apply.apply(request(fx), version, fx.backups, quiet);
    expect(report.backupDir.startsWith(fx.backups)).toBe(true);
    expect(report.backupDir.startsWith(fx.library)).toBe(false);
    expect(exists(path.join(fx.library, '.backups'))).toBe(false);
    expect(walk(fx.library)).toEqual(before);
  });

  function walk(dir) {
    const out = [];
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p); else out.push(p);
      }
    }
    return out.sort();
  }
});

test.describe('backups', () => {
  test('back-to-back backups never share a folder, even in the same millisecond', () => {
    const fx = fixture('collide');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    const frozen = new Date(2026, 8, 27, 12, 0, 0, 0);
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const { dir } = apply.backUp(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, 'stress', () => frozen);
      expect(seen.has(dir), `reused backup folder ${dir}`).toBe(false);
      seen.add(dir);
    }
    const names = fs.readdirSync(path.join(fx.backups, 'lotus79')).sort();
    expect(names).toHaveLength(20);
    expect(names[0]).toBe('2026-09-27_120000_000');
    expect(names[1]).toBe('2026-09-27_120000_000-01');
    expect(names[19]).toBe('2026-09-27_120000_000-19');
  });

  test('list newest first, with the manifest\'s reason and count; a folder with no manifest is "unknown"', () => {
    const fx = fixture('sort');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'x');
    for (let i = 0; i < 5; i++) {
      apply.backUp(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, `run ${i}`, () => new Date(2026, 0, 1 + i, 8, 0, 0, 0));
    }
    fs.mkdirSync(path.join(fx.backups, 'lotus79', '2025-12-31_000000_000'));
    fs.writeFileSync(path.join(fx.backups, 'lotus79', 'stray.txt'), 'not a backup');
    const listed = apply.listBackups(fx.backups, 'lotus79');
    expect(listed).toHaveLength(6);
    expect(listed[0]).toMatchObject({ id: '2026-01-05_080000_000', reason: 'run 4', fileCount: 1 });
    expect(listed[0].path).toBe(path.join(fx.backups, 'lotus79', '2026-01-05_080000_000'));
    expect(Object.keys(listed[0]).sort()).toEqual(['created', 'fileCount', 'id', 'path', 'reason']);
    expect(listed[5]).toEqual({
      id: '2025-12-31_000000_000', path: path.join(fx.backups, 'lotus79', '2025-12-31_000000_000'),
      created: '2025-12-31_000000_000', reason: 'unknown', fileCount: 0,
    });
    expect(apply.listBackups(fx.backups, 'nissangtpzxt')).toEqual([]);
    expect(apply.listBackups(path.join(fx.base, 'nowhere'), 'lotus79')).toEqual([]);
  });

  test('a manifest missing a field, as serde would have refused, reads as unknown', () => {
    const fx = fixture('badmanifest');
    const dir = path.join(fx.backups, 'lotus79', '2026-01-01_000000_000');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ carFolder: 'lotus79', reason: 'x', files: [] }));
    expect(apply.listBackups(fx.backups, 'lotus79')[0]).toMatchObject({ reason: 'unknown', fileCount: 0 });
  });
});

test.describe('revert', () => {
  test('restores the backup and removes what the apply added — and nothing else', async () => {
    const fx = fixture('revert');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.tga`), 'NOT MINE');
    fs.writeFileSync(path.join(fx.car, `helmet_${CUSTOMER}.tga`), 'MY HELMET');

    // Apply adds a spec map that was not there before.
    const version = makeVersion(fx, 'v13', 'NEW PAINT', 'NEW SPEC');
    const applied = await apply.apply(request(fx), version, fx.backups, quiet);
    expect(exists(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe(true);

    const report = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
    expect(report.applied).toBe(true);
    expect(report.backupDir).toBe(applied.backupDir);
    expect(report.warnings).toEqual([]);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    // A spec map the apply introduced should not survive the revert.
    expect(exists(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe(false);
    // Another driver's paint is untouched. A helmet with my id is mine: the apply left it alone (the library keeps
    // no helmets), the backup took it with the paint, and the revert put it back as it was.
    expect(read(path.join(fx.car, `car_${STRANGER}.tga`))).toBe('NOT MINE');
    expect(read(path.join(fx.car, `helmet_${CUSTOMER}.tga`))).toBe('MY HELMET');
    expect(read(path.join(applied.backupDir, `helmet_${CUSTOMER}.tga`))).toBe('MY HELMET');

    const kinds = report.actions.map((a) => a.kind);
    expect(kinds).toEqual(['backup', 'restore', 'restore', 'remove']);
    expect(report.actions[1].detail).toBe(`car_${CUSTOMER}.tga`);
    expect(report.actions[2].detail).toBe(`helmet_${CUSTOMER}.tga`);
    expect(report.actions[3].detail).toBe('1 file(s) added since that backup were removed');
    expect(report.helmet).toEqual({ set: null, onCar: true, isDefault: false, said: 'The car\'s helmet is as it was before that apply.' });
  });

  test('a revert is itself undoable: it backs up the current state first', async () => {
    const fx = fixture('revert-twice');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    const version = makeVersion(fx, 'v13', 'NEW', null);
    await apply.apply(request(fx), version, fx.backups, quiet);
    await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);

    // Two backups now: the apply's, and the one the revert took first.
    const backups = apply.listBackups(fx.backups, 'lotus79');
    expect(backups).toHaveLength(2);
    expect(backups[0].reason).toBe(`before revert to ${backups[1].id}`);
    expect(backups[1].reason).toBe('apply v13');
    expect(read(path.join(backups[0].path, `car_${CUSTOMER}.tga`))).toBe('NEW');

    // Reverting to that safety backup by id brings the applied paint back.
    const again = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, backups[0].id, false, quiet);
    expect(again.backupDir).toBe(backups[0].path);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('NEW');
    expect(apply.listBackups(fx.backups, 'lotus79')).toHaveLength(3);
  });

  test('with no backup, or an unknown id, it refuses', async () => {
    const fx = fixture('norevert');
    await expect(apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet))
      .rejects.toThrow('There is no backup to go back to for this car.');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'x');
    await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    await expect(apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, 'no-such-backup', false, quiet))
      .rejects.toThrow('There is no backup to go back to for this car.');
  });

  test('the preflight guards apply to a revert too', async () => {
    const fx = fixture('revert-blocked');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    const simOn = { ...quiet, simState: async () => ({ simRunning: true, uiRunning: false, matched: ['iRacingSim64.exe'] }) };
    await expect(apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, simOn)).rejects.toThrow('iRacing is running.');
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('NEW');
    const forced = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, true, simOn);
    expect(forced.applied).toBe(true);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
  });

  test('restores read-only files and cooked files alike', async () => {
    const fx = fixture('revert-ro');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.mip`), 'ORIGINAL COOKED');
    await apply.apply(request(fx, { setReadOnlyAfter: true }), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(exists(path.join(fx.car, `car_${CUSTOMER}.mip`))).toBe(false);
    expect(isReadOnly(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe(true);

    const report = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
    expect(report.warnings).toEqual([]);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    expect(read(path.join(fx.car, `car_${CUSTOMER}.mip`))).toBe('ORIGINAL COOKED');
  });
});

// The helmet comes with the livery. The library keeps helmets/<set>/helmet_<its id>.tga and helmets/manifest.json
// naming a set per "<car folder>/<version>"; the id in the library's file names is never the app's.
test.describe('helmets', () => {
  const LIBRARY_ID = '31337';
  const racing = { ...quiet, simState: async () => ({ simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe'] }) };

  // A 2x2 true-colour TGA of one colour: the shape the pipeline writes, at a size a test can afford.
  function tga([r, g, b]) {
    const head = Buffer.alloc(18);
    head[2] = 2;
    head.writeUInt16LE(2, 12);
    head.writeUInt16LE(2, 14);
    head[16] = 24;
    head[17] = 0x20;
    return Buffer.concat([head, Buffer.from([b, g, r, b, g, r, b, g, r, b, g, r])]);
  }
  const SHATTER = tga([220, 55, 20]);
  const INVERTED = tga([10, 10, 10]);

  // helmets/manifest.json and the set files, as build_helmets.py writes them: v13 comes with shatter, v14 with
  // shatter-inverted, v12 with nothing.
  function withHelmets(fx, { sets = { shatter: SHATTER, 'shatter-inverted': INVERTED }, variants = { 'lotus79/v13': 'shatter', 'lotus79/v14': 'shatter-inverted' }, fallback = 'shatter', files = true } = {}) {
    const manifest = { customer_id: LIBRARY_ID, default: fallback, sets: {}, variants };
    for (const [name, bytes] of Object.entries(sets)) {
      manifest.sets[name] = { file: `helmets/${name}/helmet_${LIBRARY_ID}.tga`, body: [10, 10, 10], art: [220, 55, 20] };
      if (files) {
        fs.mkdirSync(path.join(fx.library, 'helmets', name), { recursive: true });
        fs.writeFileSync(path.join(fx.library, 'helmets', name, `helmet_${LIBRARY_ID}.tga`), bytes);
      }
    }
    fs.mkdirSync(path.join(fx.library, 'helmets'), { recursive: true });
    fs.writeFileSync(path.join(fx.library, 'helmets', 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  const carHelmet = (fx) => path.join(fx.car, `helmet_${CUSTOMER}.tga`);
  const defaultHelmet = (fx) => path.join(fx.paint, `helmet_${CUSTOMER}.tga`);
  const bytes = (p) => fs.readFileSync(p);
  const manifestOf = (dir) => JSON.parse(read(path.join(dir, 'manifest.json')));
  const ON_CAR_AND_DEFAULT = 'The shatter helmet is on the car, and is now the default for every car without a helmet of its own.';

  test('the helmet that comes with the version goes on the car under the app\'s id, and becomes the default', async () => {
    const fx = fixture('helmet-basic');
    withHelmets(fx);
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'OLD PAINT');
    fs.writeFileSync(path.join(fx.car, `helmet_${CUSTOMER}.mip`), 'cooked helmet');
    fs.writeFileSync(path.join(fx.paint, `helmet_${CUSTOMER}.mip`), 'cooked default');

    const report = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW PAINT', 'NEW SPEC'), fx.backups, quiet);
    expect(report.warnings).toEqual([]);
    expect(report.helmet).toEqual({ set: 'shatter', onCar: true, isDefault: true, said: ON_CAR_AND_DEFAULT });
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'install', 'install', 'helmet', 'cooked', 'helmet-default']);
    expect(report.actions[3].detail).toBe(`the shatter helmet -> helmet_${CUSTOMER}.tga`);
    expect(report.actions[4].detail).toBe('1 cooked .mip file deleted so the sim re-cooks');
    expect(report.actions[5].detail).toBe('the shatter helmet is now the default, for every car without a helmet of its own');

    // On the car and at the paint root, named with the app's id and not the library's; the cooked files gone so
    // the sim cooks them again.
    expect(bytes(carHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(exists(path.join(fx.car, `helmet_${CUSTOMER}.mip`))).toBe(false);
    expect(exists(path.join(fx.paint, `helmet_${CUSTOMER}.mip`))).toBe(false);
    const everywhere = [fx.paint, fx.car, fx.backups].flatMap((d) => fs.readdirSync(d, { recursive: true }).map(String));
    expect(everywhere.some((n) => n.includes(LIBRARY_ID))).toBe(false);

    // The car's backup speaks for helmets and names the default's backup, which says there was no default before.
    const m = manifestOf(report.backupDir);
    expect(m.helmetsIncluded).toBe(true);
    expect(m.files.map((f) => f.fileName)).toEqual([`car_${CUSTOMER}.tga`, `helmet_${CUSTOMER}.mip`]);
    expect(apply.isBackupId(m.defaultHelmetBackup)).toBe(true);
    const defaultBackup = path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER, m.defaultHelmetBackup);
    expect(manifestOf(defaultBackup)).toMatchObject({ carFolder: apply.DEFAULT_HELMET_FOLDER, customerId: CUSTOMER, reason: 'apply v13 to lotus79', files: [], defaultHelmet: true });
    // The default's backups are not the car's: the car lists one backup.
    expect(apply.listBackups(fx.backups, 'lotus79')).toHaveLength(1);
  });

  test('read-only afterwards covers the helmet, and the next apply writes over it', async () => {
    const fx = fixture('helmet-ro');
    withHelmets(fx);
    const report = await apply.apply(request(fx, { setReadOnlyAfter: true }), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(isReadOnly(carHelmet(fx))).toBe(true);
    expect(report.actions.at(-2)).toEqual({ kind: 'read-only', detail: '2 installed file(s) set read-only' });
    await apply.apply(request(fx, { versionId: 'v14' }), makeVersion(fx, 'v14', 'NEWER', null), fx.backups, quiet);
    expect(bytes(carHelmet(fx)).equals(INVERTED)).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(INVERTED)).toBe(true);
  });

  test('the backup and the undo cover the car\'s helmet and the default, both ways', async () => {
    // Both were there before: the revert puts both back.
    const fx = fixture('helmet-undo');
    withHelmets(fx);
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    fs.writeFileSync(carHelmet(fx), 'OLD CAR HELMET');
    fs.writeFileSync(defaultHelmet(fx), 'OLD DEFAULT');
    const applied = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(bytes(carHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(read(path.join(applied.backupDir, `helmet_${CUSTOMER}.tga`))).toBe('OLD CAR HELMET');
    const defaultBackup = path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER, manifestOf(applied.backupDir).defaultHelmetBackup);
    expect(read(path.join(defaultBackup, `helmet_${CUSTOMER}.tga`))).toBe('OLD DEFAULT');

    const report = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
    expect(report.warnings).toEqual([]);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    expect(read(carHelmet(fx))).toBe('OLD CAR HELMET');
    expect(read(defaultHelmet(fx))).toBe('OLD DEFAULT');
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'restore', 'restore', 'helmet-default']);
    expect(report.actions[3].detail).toBe('the default helmet was put back as it was');
    expect(report.helmet).toEqual({ set: null, onCar: true, isDefault: true, said: "The car's helmet is as it was before that apply, and the default helmet is as it was before it." });

    // A revert is undoable whole: the safety backup it took names a backup of the default as it stood, so going
    // back to it brings the applied helmet and the default it set back too.
    const backups = apply.listBackups(fx.backups, 'lotus79');
    expect(backups).toHaveLength(2);
    const again = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, backups[0].id, false, quiet);
    expect(again.backupDir).toBe(backups[0].path);
    expect(bytes(carHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SHATTER)).toBe(true);
  });

  test('where there was no helmet before, the undo takes the car\'s away and the default with it', async () => {
    const fx = fixture('helmet-undo-none');
    withHelmets(fx);
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(exists(carHelmet(fx)) && exists(defaultHelmet(fx))).toBe(true);

    const report = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
    expect(report.warnings).toEqual([]);
    expect(exists(carHelmet(fx))).toBe(false);
    expect(exists(defaultHelmet(fx))).toBe(false);
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'restore', 'remove', 'helmet-default']);
    expect(report.actions[3].detail).toBe('the default helmet that apply set was taken away: there was none before it');
    expect(report.helmet).toEqual({ set: null, onCar: false, isDefault: false, said: 'The helmet that apply put on the car was taken off, and the default helmet it set was taken away.' });
  });

  test('a backup from before the app kept helmets leaves a helmet on the car alone when reverted to', async () => {
    const fx = fixture('helmet-old-backup');
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    const applied = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    // As an older build wrote it: nothing said of helmets.
    const m = manifestOf(applied.backupDir);
    delete m.helmetsIncluded;
    delete m.defaultHelmetBackup;
    fs.writeFileSync(path.join(applied.backupDir, 'manifest.json'), JSON.stringify(m));
    fs.writeFileSync(carHelmet(fx), 'PUT THERE BY HAND');
    fs.writeFileSync(defaultHelmet(fx), 'DEFAULT BY HAND');

    const report = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
    expect(read(carHelmet(fx))).toBe('PUT THERE BY HAND');
    expect(read(defaultHelmet(fx))).toBe('DEFAULT BY HAND');
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'restore']);
    expect(report.helmet).toEqual({ set: null, onCar: false, isDefault: false, said: '' });
  });

  test('no helmet list, no entry for the version, or a set file that is missing leaves the car\'s helmet alone, and says so', async () => {
    const version = (fx) => makeVersion(fx, 'v13', 'NEW', null);
    const untouched = async (fx, said) => {
      fs.writeFileSync(carHelmet(fx), 'MY HELMET');
      fs.writeFileSync(defaultHelmet(fx), 'MY DEFAULT');
      const report = await apply.apply(request(fx), version(fx), fx.backups, quiet);
      expect(report.helmet).toMatchObject({ onCar: false, isDefault: false, said });
      expect(report.warnings).toEqual([]);
      expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'install', 'cooked']);
      expect(read(carHelmet(fx))).toBe('MY HELMET');
      expect(read(defaultHelmet(fx))).toBe('MY DEFAULT');
      expect(exists(path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER))).toBe(false);
      expect(manifestOf(report.backupDir).defaultHelmetBackup).toBeNull();
      return report;
    };

    const none = fixture('helmet-no-list');
    expect((await untouched(none, 'The library keeps no helmets, so the helmet on the car was left as it was.')).helmet.set).toBeNull();

    const entry = fixture('helmet-no-entry');
    withHelmets(entry, { variants: { 'lotus79/v14': 'shatter-inverted' } });
    expect((await untouched(entry, 'No helmet comes with this version, so the helmet on the car was left as it was.')).helmet.set).toBeNull();

    const missing = fixture('helmet-no-file');
    withHelmets(missing, { files: false });
    expect((await untouched(missing, "The shatter helmet's file is not in the library. The car's helmet was left as it was.")).helmet.set).toBe('shatter');

    const broken = fixture('helmet-broken-list');
    fs.mkdirSync(path.join(broken.library, 'helmets'));
    fs.writeFileSync(path.join(broken.library, 'helmets', 'manifest.json'), '{ no');
    await untouched(broken, "The library's helmet list could not be read, so the helmet on the car was left as it was.");
  });

  test('a helmet list that points outside the library\'s helmets folder is refused, and nothing outside it is copied', async () => {
    const fx = fixture('helmet-outside');
    // The file is there, so what stops it is the rule.
    fs.writeFileSync(path.join(fx.base, 'evil.tga'), SHATTER);
    withHelmets(fx, { variants: { 'lotus79/v13': 'evil' }, files: false });
    const raw = JSON.parse(read(path.join(fx.library, 'helmets', 'manifest.json')));
    raw.sets.evil = { file: '../evil.tga', body: [0, 0, 0], art: [0, 0, 0] };
    fs.writeFileSync(path.join(fx.library, 'helmets', 'manifest.json'), JSON.stringify(raw));
    fs.writeFileSync(carHelmet(fx), 'MY HELMET');

    const report = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(report.helmet).toEqual({
      set: 'evil', onCar: false, isDefault: false,
      said: "The evil helmet names a file outside the library's helmets folder, so it is not used. The car's helmet was left as it was.",
    });
    expect(read(carHelmet(fx))).toBe('MY HELMET');
    expect(exists(defaultHelmet(fx))).toBe(false);
    // Nor is the paint root ever written to from a path the list names: the destination is the app's alone.
    expect(fs.readdirSync(fx.paint).sort()).toEqual(['lotus79']);
  });

  test('the sim running refuses the apply before anything is touched, the helmet and the default with the rest', async () => {
    const fx = fixture('helmet-racing');
    withHelmets(fx);
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'OLD');
    fs.writeFileSync(carHelmet(fx), 'MY HELMET');
    await expect(apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, racing)).rejects.toThrow('iRacing is running.');
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('OLD');
    expect(read(carHelmet(fx))).toBe('MY HELMET');
    expect(exists(defaultHelmet(fx))).toBe(false);
    expect(exists(fx.backups)).toBe(false);
  });

  test('a helmet that cannot be written rolls the whole apply back, a spec map it added included', async () => {
    const fx = fixture('helmet-rollback');
    withHelmets(fx);
    fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'ORIGINAL');
    fs.writeFileSync(defaultHelmet(fx), 'OLD DEFAULT');
    // Where the helmet would first be written — its temporary name — there is a folder, so the write fails after
    // the textures are in and before the helmet is.
    const inTheWay = path.join(fx.car, `helmet_${CUSTOMER}.${apply.TMP_EXT}`);
    fs.mkdirSync(inTheWay);

    const err = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW PAINT', 'NEW SPEC'), fx.backups, quiet).catch((e) => e);
    expect(err.kind).toBe('refused');
    expect(err.message).toMatch(new RegExp(`^Could not write helmet_${CUSTOMER}\\.tga \\(.+\\)\\. Everything this apply had changed was put back from `));
    expect(err.message).not.toContain('could not be restored');
    expect(read(path.join(fx.car, `car_${CUSTOMER}.tga`))).toBe('ORIGINAL');
    expect(exists(path.join(fx.car, `car_spec_${CUSTOMER}.tga`))).toBe(false);
    expect(exists(carHelmet(fx))).toBe(false);
    expect(read(defaultHelmet(fx))).toBe('OLD DEFAULT');
    expect(fs.readdirSync(fx.car, { withFileTypes: true }).filter((e) => e.isFile() && e.name.includes(apply.TMP_EXT))).toEqual([]);
    fs.rmdirSync(inTheWay);
  });

  test('a default that cannot be written is said, and the car is done all the same', async () => {
    const fx = fixture('helmet-default-fails');
    withHelmets(fx);
    fs.mkdirSync(defaultHelmet(fx));
    const report = await apply.apply(request(fx), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(report.applied).toBe(true);
    expect(bytes(carHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(report.helmet.onCar).toBe(true);
    expect(report.helmet.isDefault).toBe(false);
    expect(report.helmet.said).toMatch(/^The shatter helmet is on the car\. It could not be made the default \(.+\), so the default helmet is as it was\.$/);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/^The shatter helmet could not be made the default \(.+\)\. The default helmet is as it was\.$/);
    expect(report.actions.map((a) => a.kind)).toEqual(['backup', 'install', 'helmet', 'cooked']);
  });

  test('a group\'s car leaves the default to the group: setDefaultHelmet false, and its backup names the group\'s', async () => {
    const fx = fixture('helmet-in-group');
    withHelmets(fx);
    fs.writeFileSync(defaultHelmet(fx), 'OLD DEFAULT');
    const frozen = () => new Date(2026, 8, 30, 12, 0, 0, 0);
    const shared = apply.backUpDefault(fx.paint, fx.backups, CUSTOMER, 'set shatter', frozen);
    expect(shared).toMatchObject({ id: '2026-09-30_120000_000', had: true });

    const report = await apply.apply(request(fx, { setDefaultHelmet: false, defaultHelmetBackup: shared.id }), makeVersion(fx, 'v13', 'NEW', null), fx.backups, quiet);
    expect(bytes(carHelmet(fx)).equals(SHATTER)).toBe(true);
    expect(read(defaultHelmet(fx))).toBe('OLD DEFAULT');
    expect(report.helmet).toEqual({ set: 'shatter', onCar: true, isDefault: false, said: 'The shatter helmet is on the car.' });
    expect(manifestOf(report.backupDir).defaultHelmetBackup).toBe(shared.id);
    expect(fs.readdirSync(path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER))).toEqual([shared.id]);

    // A backup id that is not one is not taken from the request, and nothing is joined into a path from it.
    expect(apply.normaliseRequest({ ...request(fx), defaultHelmetBackup: '..\\..\\x' }).defaultHelmetBackup).toBeNull();
    expect(apply.normaliseRequest({ ...request(fx) }).setDefaultHelmet).toBe(true);
    await expect(async () => apply.restoreDefault(fx.paint, fx.backups, CUSTOMER, '../x')).rejects.toThrow('not named as one');
    await expect(async () => apply.restoreDefault(fx.paint, fx.backups, CUSTOMER, '2026-09-30_120000_099')).rejects.toThrow('no longer there');
  });
});

test('round trip: apply v13 over v12, identify, revert, identify', async () => {
  const fx = fixture('roundtrip');
  const v12 = makeVersion(fx, 'v12', 'PAINT 12', 'SPEC 12');
  const v13 = makeVersion(fx, 'v13', 'PAINT 13', 'SPEC 13');
  const versions = [v12, v13];
  // v12 is what the sim has today, installed under the customer id, plus its cooked cache.
  fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.tga`), 'PAINT 12');
  fs.writeFileSync(path.join(fx.car, `car_spec_${CUSTOMER}.tga`), 'SPEC 12');
  fs.writeFileSync(path.join(fx.car, `car_${CUSTOMER}.mip`), 'cooked 12');
  fs.writeFileSync(path.join(fx.car, `car_${STRANGER}.mip`), 'cooked stranger');

  const before = installed.identify(installed.read(fx.paint, 'lotus79', CUSTOMER), versions);
  expect(before).toMatchObject({ appliedVersionId: 'v12', matchKind: 'exact', cookedOtherDrivers: 1 });
  expect(before.cooked).toHaveLength(1);

  const applied = await apply.apply(request(fx, { versionId: 'v13' }), v13, fx.backups, quiet);
  const after = installed.identify(installed.read(fx.paint, 'lotus79', CUSTOMER), versions);
  expect(after).toMatchObject({ appliedVersionId: 'v13', matchKind: 'exact', cooked: [], cookedOtherDrivers: 1 });

  const reverted = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, null, false, quiet);
  expect(reverted.backupDir).toBe(applied.backupDir);
  const back = installed.identify(installed.read(fx.paint, 'lotus79', CUSTOMER), versions);
  expect(back).toMatchObject({ appliedVersionId: 'v12', matchKind: 'exact', cookedOtherDrivers: 1 });
  expect(back.cooked.map((p) => path.basename(p))).toEqual([`car_${CUSTOMER}.mip`]);
  expect(read(path.join(fx.car, `car_${CUSTOMER}.mip`))).toBe('cooked 12');
  expect(exists(path.join(fx.car, `car_${STRANGER}.mip`))).toBe(true);
});
